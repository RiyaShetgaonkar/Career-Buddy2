// ------------------- app.js -------------------
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const dotenv = require("dotenv");
const fs = require("fs");
const session = require("express-session");
const bcrypt = require("bcrypt");

// Firebase
const admin = require("firebase-admin");
const serviceAccount = require("./firebaseServiceAccount.json");

// Gemini
const { GoogleGenerativeAI } = require("@google/generative-ai");

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

// ------------------- NO CACHE -------------------
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  next();
});

// ------------------- SESSION -------------------
app.use(
  session({
    secret: "supersecretkey123",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60, httpOnly: true, sameSite: "lax" },
  })
);

// ------------------- CONSTANTS -------------------
const REQUIRED_FIELDS = [
  "fullName",
  "phone",
  "dob",
  "college",
  "degree",
  "branch",
  "cgpa",
  "state",
  "skills",
];

// ------------------- PUBLIC ROUTES -------------------
app.get("/", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/signup", (_, res) => res.sendFile(path.join(__dirname, "public", "signup.html")));
app.get("/login", (_, res) => res.sendFile(path.join(__dirname, "public", "login.html")));

// ------------------- SIGNUP -------------------
app.post("/signup", async (req, res) => {
  const { email, password, "confirm-password": confirmPassword } = req.body;

  if (!email || !password || !confirmPassword)
    return res.send("<h3 style='color:red;'>All fields are required</h3>");

  if (password.length < 6)
    return res.send("<h3>Password must be at least 6 characters</h3>");

  if (password !== confirmPassword)
    return res.send("<h3>Passwords do not match</h3>");

  try {
    const userRecord = await auth.createUser({ email, password });
    const hashedPassword = await bcrypt.hash(password, 10);

    await db.collection("users").doc(userRecord.uid).set({
      email,
      fullName: "",
      phone: "",
      dob: "",
      college: "",
      degree: "",
      branch: "",
      cgpa: "",
      state: "",
      skills: [],
      password: hashedPassword,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.redirect("/login");
  } catch (err) {
    console.error(err);
    res.send("<h3>Signup failed</h3>");
  }
});

// ------------------- LOGIN -------------------
app.post("/login", async (req, res) => {
  const { email } = req.body;
  try {
    const user = await auth.getUserByEmail(email);
    const doc = await db.collection("users").doc(user.uid).get();
    if (!doc.exists) return res.send("<h3>User not found</h3>");

    req.session.uid = user.uid;
    req.session.email = email;

    res.redirect("/main");
  } catch (err) {
    console.error(err);
    res.send("<h3>Login failed</h3>");
  }
});

// ------------------- AUTH MIDDLEWARE -------------------
const protectedRoutes = [
  "/main",
  "/view-details",
  "/update-details",
  "/getUserDetails",
  "/updateUserDetails",
  "/profile-status",
  "/chat",
];

app.use(protectedRoutes, (req, res, next) => {
  // Prevent caching
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");

  if (!req.session.uid) return res.redirect("/login");
  next();
});

// ------------------- DASHBOARD & MAIN -------------------
app.get("/main", async (req, res) => {
  const uid = req.session.uid;
  if (!uid) return res.redirect("/login");

  try {
    const doc = await db.collection("users").doc(uid).get();
    if (!doc.exists) return res.redirect("/login");

    const data = doc.data();

    // Check if profile is empty
    const profileEmpty = REQUIRED_FIELDS.every(
      (f) => Array.isArray(data[f]) ? data[f].length === 0 : !data[f]
    );

    if (profileEmpty) {
      // Serve dashboard.html with username replaced
      const html = fs
        .readFileSync(path.join(__dirname, "public", "dashboard.html"), "utf8")
        .replace(/USERNAME_HERE/g, data.fullName || "");
      return res.send(html);
    }

    // Profile filled → main.html
    res.sendFile(path.join(__dirname, "public", "main.html"));
  } catch (err) {
    console.error(err);
    res.send("<h3>Unable to load dashboard</h3>");
  }
});

// ------------------- PROFILE STATUS -------------------
app.get("/profile-status", async (req, res) => {
  try {
    const doc = await db.collection("users").doc(req.session.uid).get();
    const data = doc.data();
    const completed = REQUIRED_FIELDS.every(
      (f) => Array.isArray(data[f]) ? data[f].length > 0 : !!data[f]
    );
    res.json({ completed });
  } catch {
    res.json({ completed: false });
  }
});

// ------------------- UPDATE DETAILS -------------------
app.post("/updateUserDetails", async (req, res) => {
  try {
    // Map dashboard form fields to Firestore
    const payload = {
      fullName: req.body["data[Name]"] || "",
      phone: req.body["data[Phone Number]"] || "",
      dob: req.body["data[Date of Birth]"] || "",
      college: req.body["data[College / University Name]"] || "",
      degree: req.body["data[Degree]"] || "",
      branch: req.body["data[Branch / Specialization]"] || "",
      cgpa: req.body["data[CGPA / Percentage]"] || "",
      state: req.body["data[State]"] || "",
      skills: req.body["data[Skills]"]
        ? req.body["data[Skills]"].split(",").map((s) => s.trim())
        : [],
    };

    await db
      .collection("users")
      .doc(req.session.uid)
      .set({ ...payload, updatedAt: new Date() }, { merge: true });

    res.json({ message: "Profile updated successfully", redirect: "/main" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Update failed" });
  }
});

// ------------------- VIEW DETAILS -------------------
app.get("/view-details", (_, res) =>
  res.sendFile(path.join(__dirname, "public", "view-details.html"))
);

app.get("/getUserDetails", async (req, res) => {
  const doc = await db.collection("users").doc(req.session.uid).get();
  res.json(doc.data());
});

// ------------------- GEMINI CHATBOT -------------------
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
  systemInstruction: `
ROLE: Career & Academic Guidance Bot
Only answer career/academic queries.
Off-topic → refuse politely using the exact sentence.
Use Markdown.
`,
});

app.post("/chat", async (req, res) => {
  try {
    const result = await model.generateContent(req.body.message);
    res.json({ reply: result.response.text() });
  } catch (err) {
    console.error(err);
    res.json({ reply: "Sorry, I couldn't process your message." });
  }
});

// ------------------- LOGOUT -------------------
app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout error:", err);
      return res.redirect("/main");
    }
    res.clearCookie("connect.sid", { path: "/" });
    res.redirect("/login?loggedout=true");
  });
});

// ------------------- SERVER -------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
