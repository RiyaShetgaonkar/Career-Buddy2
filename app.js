// ------------------- app.js -------------------
const coursesData = require("./coursesData");
const internshipsData = require("./internshipsData");
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
// ✅ Updated to include "year" (lowercase) to match your Firestore schema
const REQUIRED_FIELDS = [
  "fullName",
  "phone",
  "dob",
  "college",
  "degree",
  "branch",
  "year", 
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
      year: "",
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
const protectedRoutes = ["/main", "/view-details", "/update-details", "/getUserDetails", "/updateUserDetails", "/profile-status", "/chat"];
app.use(protectedRoutes, (req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  if (!req.session.uid) return res.redirect("/login");
  next();
});

// ------------------- DASHBOARD & MAIN -------------------
app.get("/main", async (req, res) => {
  const uid = req.session.uid;
  try {
    const doc = await db.collection("users").doc(uid).get();
    const data = doc.data();
    const profileEmpty = REQUIRED_FIELDS.every(
      (f) => Array.isArray(data[f]) ? data[f].length === 0 : !data[f]
    );

    if (profileEmpty) {
      const html = fs.readFileSync(path.join(__dirname, "public", "dashboard.html"), "utf8")
        .replace(/USERNAME_HERE/g, data.fullName || "Student");
      return res.send(html);
    }
    res.sendFile(path.join(__dirname, "public", "main.html"));
  } catch (err) {
    res.send("<h3>Unable to load dashboard</h3>");
  }
});

// ------------------- UPDATE DETAILS (Unified Final Fix) -------------------
app.post("/updateUserDetails", async (req, res) => {
  try {
    const uid = req.session.uid;
    if (!uid) return res.status(401).json({ message: "Unauthorized" });

    // DEBUG: This will print the exact structure coming from your browser to your terminal
    console.log("DEBUG: DATA RECEIVED FROM CLIENT:", req.body);

    const b = req.body; // Shortcut

    const payload = {
      fullName: b["data[Name]"] || b.fullName || b.Name || "",
      phone: b["data[Phone Number]"] || b.phone || "",
      dob: b["data[Date of Birth]"] || b.dob || "",
      college: b["data[College / University Name]"] || b.college || "",
      
      // ✅ CATCHES EVERY VARIATION: dashboard, manage profile, or raw json
      year: b["data[Year]"] || b["data[Year of Study]"] || b.year || "", 
      
      degree: b["data[Degree]"] || b.degree || "",

      // ✅ HANDLES: specialization strings
      branch: b["data[Branch / Specialization]"] || b["data[Branch]"] || b.branch || "",
      
      cgpa: b["data[CGPA / Percentage]"] || b.cgpa || "",
      state: b["data[State]"] || b.state || "",
      
      // Skills handling: checks if already array or needs splitting
      skills: Array.isArray(b["data[Skills]"] || b.skills) 
        ? (b["data[Skills]"] || b.skills)
        : (b["data[Skills]"] || b.skills || "")
            .toString()
            .split(",")
            .map(s => s.trim())
            .filter(s => s !== "")
    };

    // Use merge: true so we don't overwrite email/password fields
    await db.collection("users").doc(uid).set({ 
      ...payload, 
      updatedAt: new Date() 
    }, { merge: true });

    console.log("DEBUG: Firestore Update Successful for UID:", uid);
    res.json({ success: true, message: "Profile updated", redirect: "/main" });
    
  } catch (err) {
    console.error("CRITICAL UPDATE ERROR:", err);
    res.status(500).json({ success: false, message: "Server error during update" });
  }
});
// ------------------- VIEW DETAILS -------------------
app.get("/view-details", (_, res) => res.sendFile(path.join(__dirname, "public", "view-details.html")));

app.get("/getUserDetails", async (req, res) => {
  const doc = await db.collection("users").doc(req.session.uid).get();
  res.json(doc.data());
});

// ------------------- RECOMMEND COURSES -------------------
app.get("/getRecommendedCourses", async (req, res) => {
  try {
    console.log("HIT /getRecommendedCourses");

    if (!req.session.uid) {
      console.log("NO SESSION UID");
      return res.status(401).json([]);
    }

    const doc = await db.collection("users").doc(req.session.uid).get();

    if (!doc.exists) {
      console.log("USER DOC NOT FOUND");
      return res.json([]);
    }

    const user = doc.data();
    console.log("USER DATA:", user);

    const normalize = (s) => s.toLowerCase().trim();
    const normalizeArray = (arr) => arr.map(v => normalize(v));

    const userSkills = Array.isArray(user.skills)
  ? normalizeArray(user.skills)
  : [];

const userBranch = user.branch ? normalize(user.branch) : "";
const userDegree = user.degree ? normalize(user.degree) : "";
const userCGPA = parseFloat(user.cgpa) || 0;

let recommended = coursesData
  .filter(course => {
    const courseDegrees = normalizeArray(course.degree);
    const courseBranches = normalizeArray(course.branch);

    // ✅ DEGREE MUST MATCH
    const degreeMatch =
      courseDegrees.includes("any") ||
      courseDegrees.includes(userDegree);

    if (!degreeMatch) return false;

    // ✅ BRANCH MUST MATCH
    const branchMatch =
      courseBranches.includes("any") ||
      courseBranches.includes(userBranch);

    if (!branchMatch) return false;

    // ✅ CGPA CHECK
    if (userCGPA < course.cgpaMin) return false;

    return true;
  })
  .map(course => {
    // 🎯 Skill relevance scoring (ONLY after degree+branch match)
    let skillScore = 0;

    course.skills.forEach(skill => {
      if (userSkills.includes(normalize(skill))) {
        skillScore += 1;
      }
    });

    return {
      ...course,
      skillScore
    };
  })
  // ❌ Remove courses with ZERO skill relevance
  .filter(c => c.skillScore > 0)
  // 🔥 Best matches first
  .sort((a, b) => b.skillScore - a.skillScore);

  if (recommended.length === 0) {
  recommended = coursesData.filter(course => {
    const courseDegrees = normalizeArray(course.degree);
    const courseBranches = normalizeArray(course.branch);

    return (
      (courseDegrees.includes("any") || courseDegrees.includes(userDegree)) &&
      courseBranches.includes("any") &&
      userCGPA >= course.cgpaMin
    );
  });
}

    console.log("RECOMMENDED COUNT:", recommended.length);

    res.json(recommended);
  } catch (err) {
    console.error("COURSE ROUTE ERROR:", err);
    res.status(500).json([]);
  }

});

// ------------------- RECOMMEND INTERNSHIPS -------------------
app.get("/getRecommendedInternships", async (req, res) => {
  try {
    console.log("HIT /getRecommendedInternships");

    if (!req.session.uid) return res.status(401).json([]);

    const doc = await db.collection("users").doc(req.session.uid).get();
    if (!doc.exists) return res.json([]);

    const user = doc.data();

    const normalize = (s) => s.toLowerCase().trim();
    const normalizeArray = (arr) => arr.map(v => normalize(v));

    const userSkills = Array.isArray(user.skills)
      ? normalizeArray(user.skills)
      : [];

    const userBranch = user.branch ? normalize(user.branch) : "";
    const userDegree = user.degree ? normalize(user.degree) : "";
    const userCGPA = parseFloat(user.cgpa) || 0;

    let recommended = internshipsData
      .filter(internship => {
        const internshipDegrees = normalizeArray(internship.degree);
        const internshipBranches = normalizeArray(internship.branch);

        // ✅ DEGREE MUST MATCH
        const degreeMatch =
          internshipDegrees.includes("any") ||
          internshipDegrees.includes(userDegree);

        if (!degreeMatch) return false;

        // ✅ BRANCH MUST MATCH
        const branchMatch =
          internshipBranches.includes("any") ||
          internshipBranches.includes(userBranch);

        if (!branchMatch) return false;

        // ✅ CGPA CHECK
        if (userCGPA < internship.cgpaMin) return false;

        return true;
      })
      .map(internship => {
        let skillScore = 0;

        internship.skills.forEach(skill => {
          if (userSkills.includes(normalize(skill))) {
            skillScore += 1;
          }
        });

        return { ...internship, skillScore };
      })
      // ❌ remove irrelevant internships
      .filter(i => i.skillScore > 0)
      // 🔥 best matches first
      .sort((a, b) => b.skillScore - a.skillScore);

    // 🧠 FALLBACK: Degree-only internships
    if (recommended.length === 0) {
      recommended = internshipsData.filter(internship => {
        const internshipDegrees = normalizeArray(internship.degree);
        const internshipBranches = normalizeArray(internship.branch);

        return (
          (internshipDegrees.includes("any") ||
            internshipDegrees.includes(userDegree)) &&
          internshipBranches.includes("any") &&
          userCGPA >= internship.cgpaMin
        );
      });
    }

    console.log("INTERNSHIP COUNT:", recommended.length);
    res.json(recommended);
  } catch (err) {
    console.error("INTERNSHIP ROUTE ERROR:", err);
    res.status(500).json([]);
  }
});


// ------------------- GEMINI CHATBOT (Firestore Integrated) -------------------

const systemInstruction = `
ROLE: You are a strict Career and Academic Guidance Chatbot.

TOPICS ALLOWED:
1. Interviewing: Technical/HR preparation, top interview questions.
2. Resumes: Formatting, bullet points, and optimization.
3. Academics: Study plans, timetables, and what to study next in a curriculum.
4. Skills: Career-relevant technical or soft skills to develop next.

STRICT GUARDRAILS:
1. LENGTH: Your entire response MUST be between 5 to 6 lines long. Be extremely concise.
2. SCOPE: Refuse topics like clothing, food, celebrities, or general lifestyle.
3. REFUSAL TEXT: "I apologize, but I am specialized in career and academic guidance only. I cannot provide information on other topics."
4. FORMAT: Use Markdown: **bold** for key careers/skills and bullet points for lists.
`;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Model Initialization with fallback
let model;
try {
  model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    systemInstruction: systemInstruction
  });
} catch (e) {
  model = genAI.getGenerativeModel({
    model: "gemini-pro",
    systemInstruction: systemInstruction
  });
}

app.post("/chat", async (req, res) => {
  const { message } = req.body;
  const uid = req.session.uid;

  if (!uid) {
    return res.status(401).json({ reply: "Please log in to chat." });
  }

  try {
    const userDoc = await db.collection("users").doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};

    const userContext = `
Student Name: ${userData.fullName || "Student"}
Year: ${userData.year || "Unknown"}
Degree: ${userData.degree || "Unknown"}
Branch: ${userData.branch || "Unknown"}
Skills: ${(userData.skills || []).join(", ") || "No skills listed yet"}
`;

    const prompt = `
Student Data:
${userContext}

User Message:
"${message}"

Instructions:
1. Answer the message only if it relates to careers, interviews, resumes, or academics.
2. Keep the answer strictly between 5 to 6 lines.
3. Provide specific advice based on the student's branch (${userData.branch}) and year (${userData.year}).
`;

    const result = await model.generateContent(prompt);
    res.json({ reply: result.response.text() });

  } catch (err) {
    console.error("Chat Error:", err);
    res.status(500).json({
      reply: "I apologize, but I'm having trouble connecting to the AI right now."
    });
  }
});
// ------------------- LOGOUT -------------------
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.redirect("/login?loggedout=true");
  });
});

// ------------------- SERVER -------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));