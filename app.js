// ------------------- app.js -------------------
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const dotenv = require("dotenv");
const bcrypt = require("bcrypt");
const fs = require("fs");
const session = require("express-session");
const fetch = require("node-fetch");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Firebase
const admin = require("firebase-admin");
const serviceAccount = require("./firebaseServiceAccount.json");

// ------------------- ENV -------------------
dotenv.config();

// ------------------- FIREBASE INIT -------------------
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const auth = admin.auth();

// ------------------- APP INIT -------------------
const app = express();

// ------------------- MIDDLEWARE -------------------
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// ------------------- SESSION SETUP -------------------
app.use(
  session({
    secret: "supersecretkey123",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60, // 1 hour
      httpOnly: true,
      sameSite: "lax",
    },
  })
);

// ------------------- PUBLIC ROUTES -------------------
app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);
app.get("/signup", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "signup.html"))
);
app.get("/login", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "login.html"))
);

// ------------------- SIGNUP -------------------
app.post("/signup", async (req, res) => {
  const { email, password, "confirm-password": confirmPassword } = req.body;
  if (!email || !password || !confirmPassword)
    return res.send("<h3 style='color:red;'>All fields are required</h3>");
  if (password !== confirmPassword)
    return res.send("<h3 style='color:red;'>Passwords do not match</h3>");

  try {
    // Create Firebase Auth user
    const userRecord = await auth.createUser({ email, password });

    // Hash password before saving to Firestore
    const hashedPassword = await bcrypt.hash(password, 10);

    // Save user in Firestore
    await db.collection("users").doc(userRecord.uid).set({
      email,
      password: hashedPassword,  // ✅ Add hashed password
      createdAt: new Date(),
    });

    res.send(`
      <h2>✅ Signup successful!</h2>
      <a href="/login">Login Now</a>
    `);
  } catch (err) {
    console.error(err);
    if (err.code === "auth/email-already-exists")
      return res.send("<h3 style='color:red;'>Email already in use</h3>");
    res.status(500).send("<h3 style='color:red;'>Signup failed</h3>");
  }
});

// ------------------- LOGIN -------------------
app.post("/login", async (req, res) => {
  const { email, password } = req.body; // Make sure input name="email"

  try {
    // Find user in Firestore by email
    const usersSnap = await db
      .collection("users")
      .where("email", "==", email)
      .limit(1)
      .get();

    if (usersSnap.empty)
      return res.send("<h3 style='color:red;'>Invalid email or password</h3>");

    const userDoc = usersSnap.docs[0];
    const userData = userDoc.data();

    if (!userData.password)
      return res.send("<h3 style='color:red;'>User has no password set</h3>");

    // Compare hashed password
    const isMatch = await bcrypt.compare(password, userData.password);

    if (!isMatch)
      return res.send("<h3 style='color:red;'>Invalid email or password</h3>");

    // Store session
    req.session.uid = userDoc.id;
    req.session.email = email;

    res.redirect("/main");
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).send("<h3 style='color:red;'>Login failed</h3>");
  }
});


// ------------------- AUTH MIDDLEWARE -------------------
app.use((req, res, next) => {
  const protectedRoutes = [
    "/main",
    "/chat",
    "/logout",
    "/updateUserDetails",
    "/view-details",
    "/getUserDetails",
  ];

  if (!req.session.uid && protectedRoutes.includes(req.path)) {
    return res.redirect("/login");
  }
  next();
});

// ------------------- MAIN PAGE -------------------
app.get("/main", (req, res) => {
  const email = req.session.email;
  if (!email) return res.redirect("/login?sessionexpired=true");

  const displayName = email.split("@")[0];

  const mainHTML = fs
    .readFileSync(path.join(__dirname, "public", "main.html"), "utf8")
    .replace(/Username:\s*JohnDoe/, `Username: ${displayName}`);

  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    Pragma: "no-cache",
    Expires: "0",
  });

  res.send(mainHTML);
});

// ------------------- VIEW DETAILS -------------------
app.get("/view-details", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "view-details.html"))
);

// ------------------- LOGOUT -------------------
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.redirect("/login?loggedout=true");
  });
});

// ------------------- GEMINI AI CHATBOT -------------------
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash-lite",
  systemInstruction: `
    ROLE: You are a strict Career and Academic Guidance Chatbot.

    GUARDRAILS:
    1. ONLY career & academic questions.
    2. Off-topic → refuse politely.
    3. Use this phrase:
       "I apologize, but I am specialized in career and academic guidance only. I cannot provide information on other topics."
    4. Markdown formatting required.
  `,
});

app.post("/chat", async (req, res) => {
  const { message } = req.body;

  try {
    const prompt = `
Example:
User: Is coffee better than tea?
Bot: I apologize, but I am specialized in career and academic guidance only. I cannot provide information on other topics.

User: ${message}
Response:
    `;

    const result = await model.generateContent(prompt);
    res.json({ reply: result.response.text() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ reply: "AI error occurred." });
  }
});

// ------------------- UPDATE USER DETAILS -------------------
app.post("/updateUserDetails", async (req, res) => {
  const { uid } = req.session;
  if (!uid) return res.status(401).json({ message: "Session expired" });

  try {
    const userRef = db.collection("users").doc(uid);

    // Append the new update to a "history" array inside the user's document
    await userRef.set(
      {
        history: admin.firestore.FieldValue.arrayUnion({
          ...req.body,
          updatedAt: new Date(),
        }),
        // Optional: keep the latest snapshot
        latest: { ...req.body, updatedAt: new Date() },
      },
      { merge: true } // merge so we don’t overwrite the whole user doc
    );

    res.json({ message: "Details updated and appended successfully!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Update failed." });
  }
});



// ------------------- FETCH USER DETAILS -------------------
app.get("/getUserDetails", async (req, res) => {
  const { uid } = req.session;
  if (!uid) return res.status(401).json({ message: "Session expired" });

  try {
    const doc = await db.collection("users").doc(uid).get();

    if (!doc.exists) return res.json({ message: "No details found." });

    // Return the latest snapshot (or full history if you want)
    res.json(doc.data().latest || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Fetch failed." });
  }
});

// ------------------- CHECK FIRESTORE CONNECTION -------------------
async function checkFirestoreConnection() {
  try {
    const collections = await db.listCollections(); // Safe check
    console.log(
      `✅ Firestore connected! Found ${collections.length} top-level collections.`
    );
  } catch (err) {
    console.error("❌ Firestore connection failed:", err);
  }
}

// Call before server start
checkFirestoreConnection();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);
