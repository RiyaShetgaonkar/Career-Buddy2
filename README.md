Career Buddy 🚀
Career Buddy is a smart, user-friendly career guidance platform designed to act as a personal mentor for students. By leveraging AI and personalized data filtering, it bridges the gap between academic learning and professional employment.

🌟 Key Features
🤖 AI Career Chatbot
Gemini-Powered: Integrated with Google's Generative AI to provide academic and career advice.

Context-Aware: Tailors responses based on the user's current year, degree,branch and skills stored in Firestore.

Guardrailed: Focused strictly on resumes, interviews, and study plans.

🚀 Live Demo

🔗 [Visit Career Buddy](https://career-buddy2-1hod.onrender.com)

📚 Smart Course Catalog
Dual-Filtering System: * Catalog View: A dropdown select-bar shows every course available for the user's specific Degree and Branch.

Personalized Recommendations: Dynamic cards display only the courses that match the user's current Year of Study and CGPA.

Direct Access: One-click "Go" functionality to visit external course platforms like NPTEL, Coursera, and Udemy.

💼 Internship Matchmaker
Skill-Based Scoring: Ranks internships based on how well the user's skills match the internship requirements.

Criteria Matching: Only shows internships where the user meets the minimum CGPA and degree requirements.

🔐 Secure User Management
Authentication: Firebase Auth and Session-based login management.

Profile Management: Comprehensive dashboard to update CGPA, skills, and academic details.

🛠️ Tech Stack
Frontend: HTML5, CSS3 (Custom animations/Glassmorphism), JavaScript (Vanilla).

Backend: Node.js, Express.js.

Database: Firebase Firestore (NoSQL).

AI Engine: Google Generative AI (Gemini 1.5 Flash).

Authentication: Firebase Admin SDK & Express Sessions.

Security: Bcrypt (Password hashing).

🚀 Getting Started
1. Prerequisites
Node.js installed.

A Firebase Project with Firestore enabled.

A Google AI Studio API Key.

2. Configuration
Create a .env file in the root directory:

Code snippet
PORT=3000
GEMINI_API_KEY=your_gemini_api_key_here
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_CLIENT_EMAIL=your_client_email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYourKeyHere\n-----END PRIVATE KEY-----\n"

Place your Firebase Service Account JSON in the root folder as: firebaseServiceAccount.json

3. Installation
Bash
# Install dependencies
npm install

# Start the server
node app.js
📂 Project Structure
Plaintext
├── public/                 # Frontend assets (HTML, CSS, JS)
├── app.js                  # Express server & API Logic
├── coursesData.js          # Course Database (JSON)
├── internshipsData.js      # Internship Database (JSON)
└── package.json            # Node.js dependencies

📝 Usage Note
The platform uses Dual-Logic filtering. To see all departmental courses in the dropdown, ensure your profile has your Degree and Branch accurately filled out. Recommendations will automatically update as you update your Year of Study and CGPA.



