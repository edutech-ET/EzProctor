const crypto = require("crypto");
const os = require("os");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const express = require("express");
const cors = require("cors");
const { WebSocketServer } = require("ws");
const { getDefaultFilesForLanguage, mapFilesForLanguage } = require("./examStore");
const { runPythonWorkspace } = require("./pythonRunner");
const { runRustWorkspace } = require("./rustRunner");
const { generateQuestionsWithAI, importQuestionsFromDocument } = require("./aiQuestionGenerator");
const { suggestQuestionGrade } = require("./gradingAssistant");
const { mapModelAnswers, parseModelAnswers } = require("./modelAnswerImporter");
const { createAnswerBookPdf } = require("./answerBookPdf");
const { activatePlatform, activationStatus } = require("./licenseManager");
const {
  approveRegistration,
  buildAnswerBook,
  buildSubmissionAnswerBook,
  createExam,
  createRegistration,
  createSession,
  createStudent,
  updateExam,
  updateSession,
  updateStudent,
  deleteSubmission,
  deleteExam,
  deleteSession,
  deleteStudent,
  findRegistration,
  findStudentByNumber,
  finalizeSessionSubmissions,
  getActiveSession,
  getExamById,
  getCurrentLobbySession,
  getOpenTimer,
  getWorkspace,
  getSessionById,
  gradeSubmission,
  importStudents,
  listExams,
  listRegistrations,
  listSessions,
  listStudents,
  listSubmissions,
  getSubmissionById,
  getQuestionAnswer,
  saveQuestionAnswer,
  gradeQuestionAnswer,
  markRegistrationCheckedIn,
  markStudentCheckedIn,
  recordActivity,
  recordSubmission,
  rejectRegistration,
  revokeRegistrationApproval,
  saveWorkspace,
  setLastRun,
  updateSessionStatus
} = require("./db");
const { addEvent, listSessions: listLiveSessions, markSubmitted, upsertSnapshot } = require("./sessionStore");

const projectRoot = path.resolve(__dirname, "..", "..");
const publicDir = path.resolve(__dirname, "..", "public");
const dashboardDistDir = path.resolve(projectRoot, "dashboard", "dist");

try {
  // eslint-disable-next-line global-require
  require("dotenv").config({ path: path.resolve(projectRoot, ".env") });
} catch (error) {}

const app = express();
const port = Number(process.env.BACKEND_PORT || 8787);
const dashboardOrigin = process.env.DASHBOARD_ALLOWED_ORIGIN || "http://localhost:5173";
const educatorUsername = process.env.EDUCATOR_USERNAME || "ezproctor";
const defaultEducatorHash = "60b317a2999162d539401c8a1f004df0126ddf2d059de019d5062da8eaf8fd2d";
const educatorSessions = new Map();
const educatorSessionHours = Number(process.env.EDUCATOR_SESSION_HOURS || 8);
const activationAttempts = new Map();

app.use(cors({ origin: [dashboardOrigin, true], credentials: true }));
app.use(express.json({ limit: "12mb" }));
app.use((req, res, next) => {
  if (["/exam-mode.html", "/ide.html", "/admin.html"].includes(req.path) && !activationStatus().activated) {
    return res.redirect("/admin-app/?activation=required");
  }
  next();
});
app.use(express.static(publicDir));

app.get("/api/activation/status", (_req, res) => {
  res.json(activationStatus());
});

app.post("/api/activation", (req, res) => {
  const attemptKey = req.ip || req.socket.remoteAddress || "unknown";
  const attempt = activationAttempts.get(attemptKey) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
  if (attempt.resetAt <= Date.now()) {
    attempt.count = 0;
    attempt.resetAt = Date.now() + 15 * 60 * 1000;
  }
  if (attempt.count >= 10) {
    return res.status(429).json({ error: "Too many activation attempts. Try again in 15 minutes." });
  }
  attempt.count += 1;
  activationAttempts.set(attemptKey, attempt);
  try {
    const status = activatePlatform(req.body || {});
    activationAttempts.delete(attemptKey);
    res.json(status);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.use("/api", (req, res, next) => {
  if (!activationStatus().activated) {
    return res.status(402).json({
      error: "EzProctor must be activated by an educational institution before use.",
      activationRequired: true,
      requestKeyEmail: "eozoe2025@gmail.com"
    });
  }
  next();
});

function cookiesFromRequest(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map((entry) => entry.trim().split(/=(.*)/s)).filter(([key]) => key));
}

function validEducatorSession(req) {
  const token = cookiesFromRequest(req).ezproctor_educator;
  const session = token ? educatorSessions.get(token) : null;
  if (!session || session.expiresAt <= Date.now()) {
    if (token) educatorSessions.delete(token);
    return null;
  }
  return session;
}

function passwordMatches(password) {
  const candidate = crypto.scryptSync(String(password || ""), "ezproctor-educator-v1", 32);
  const expected = process.env.EDUCATOR_PASSWORD
    ? crypto.scryptSync(process.env.EDUCATOR_PASSWORD, "ezproctor-educator-v1", 32)
    : Buffer.from(defaultEducatorHash, "hex");
  return crypto.timingSafeEqual(candidate, expected);
}

app.post("/api/educator-auth/login", (req, res) => {
  if (String(req.body.username || "") !== educatorUsername || !passwordMatches(req.body.password)) {
    res.status(401).json({ error: "Incorrect educator username or password." });
    return;
  }
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + educatorSessionHours * 60 * 60 * 1000;
  educatorSessions.set(token, { username: educatorUsername, expiresAt });
  res.setHeader("Set-Cookie", `ezproctor_educator=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${educatorSessionHours * 3600}`);
  res.json({ authenticated: true, username: educatorUsername, expiresAt: new Date(expiresAt).toISOString() });
});

app.get("/api/educator-auth/session", (req, res) => {
  const session = validEducatorSession(req);
  if (!session) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, username: session.username, expiresAt: new Date(session.expiresAt).toISOString() });
});

app.post("/api/educator-auth/logout", (req, res) => {
  const token = cookiesFromRequest(req).ezproctor_educator;
  if (token) educatorSessions.delete(token);
  res.setHeader("Set-Cookie", "ezproctor_educator=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.json({ authenticated: false });
});

app.use("/api/dashboard", (req, res, next) => {
  if (!validEducatorSession(req)) return res.status(401).json({ error: "Educator login required." });
  next();
});

app.get("/", (_req, res) => {
  res.sendFile(path.resolve(publicDir, "index.html"));
});

function requireActivatedPage(req, res, next) {
  if (!activationStatus().activated) return res.redirect("/admin-app/?activation=required");
  next();
}

app.get("/exam-mode", requireActivatedPage, (_req, res) => {
  res.sendFile(path.resolve(publicDir, "exam-mode.html"));
});

app.get("/ide", requireActivatedPage, (_req, res) => {
  res.sendFile(path.resolve(publicDir, "ide.html"));
});

app.get("/admin-legacy", (_req, res) => {
  res.sendFile(path.resolve(publicDir, "admin.html"));
});

if (fs.existsSync(dashboardDistDir)) {
  app.use("/admin-app/assets", express.static(path.resolve(dashboardDistDir, "assets")));
  app.use("/admin-app", express.static(dashboardDistDir));
  app.get("/admin-app", (_req, res) => {
    res.sendFile(path.resolve(dashboardDistDir, "index.html"));
  });
  app.get("/admin-app/*", (_req, res) => {
    res.sendFile(path.resolve(dashboardDistDir, "index.html"));
  });
  app.get("/admin", (_req, res) => {
    res.redirect("/admin-app");
  });
} else {
  app.get("/admin", (_req, res) => {
    res.sendFile(path.resolve(publicDir, "admin.html"));
  });
}

function overviewPayload() {
  return {
    exams: listExams(),
    sessions: listSessions(),
    students: listLiveSessions(),
    roster: listStudents(),
    registrations: listRegistrations(),
    submissions: listSubmissions()
  };
}

function ensureOpenIdentity(req) {
  const target = req.method === "GET" ? req.query : req.body;
  const activeSession = getActiveSession();
  target.sessionId = target.sessionId || activeSession?.id || "open-session";
  target.studentId = target.studentId || "open-student";
  target.examId = target.examId || activeSession?.examId || "open-exam";
  target.studentName = target.studentName || "Open Student";
  return target;
}

function normalizeRuntimeLanguage(language = "") {
  const normalized = String(language).trim().toLowerCase();
  if (normalized.includes("rust") || normalized.includes("rush") || normalized === "rs") {
    return "Rust";
  }
  if (normalized.includes("html") || normalized.includes("frontend") || normalized === "web") {
    return "HTML";
  }
  return "Python";
}

function resolveExamLanguage(identity, requestedLanguage) {
  const session = getSessionById(identity.sessionId) || null;
  const effectiveExamId = session?.examId || identity.examId;
  const exam = getExamById(effectiveExamId) || null;
  return normalizeRuntimeLanguage(requestedLanguage || exam?.language || session?.language || "Python");
}

function getRuntimeDefaults(identity, requestedLanguage) {
  const language = resolveExamLanguage(identity, requestedLanguage);
  return {
    language,
    defaultFiles: getDefaultFilesForLanguage(language)
  };
}

function mapRuntimeFiles(language, files, defaultFiles) {
  const sourceFiles = files && Object.keys(files).length ? files : defaultFiles;
  return mapFilesForLanguage(language, sourceFiles);
}

async function runWorkspaceByLanguage(language, files, stdin) {
  if (language === "Rust") {
    return runRustWorkspace(files, stdin);
  }
  if (language === "HTML") {
    return {
      ok: true,
      stdout: "HTML preview refreshed successfully.",
      stderr: "",
      exitCode: 0,
      command: "browser preview index.html",
      previewHtml: files["index.html"] || ""
    };
  }
  return runPythonWorkspace(files, stdin);
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function answerBookHtml(groups, title) {
  const sections = groups.map(({ session, exam, students }) => `
    <section class="session">
      <header><div><span>Session</span><h2>${escapeHtml(session.sessionName)}</h2><p>${escapeHtml(exam?.title || session.examTitle)} · ${escapeHtml(exam?.language || session.language)} · ${exam?.durationMinutes || session.durationMinutes} minutes</p></div><strong>${students.length} students</strong></header>
      ${students.length ? students.map((student) => `
        <article class="student">
          <div class="student-head"><div><span>${escapeHtml(student.studentNumber)}</span><h3>${escapeHtml(student.fullName)}</h3></div><div class="score">${student.finalScore ?? "--"}<small>Final score</small></div></div>
          ${student.questions.map((question) => {
            const answer = question.answer;
            const files = answer ? Object.entries(answer.files || {}).map(([name, content]) => `<div class="file"><strong>${escapeHtml(name)}</strong><pre>${escapeHtml(content)}</pre></div>`).join("") : "";
            const selectedText = answer?.selectedOption !== "" ? question.options?.[Number(answer.selectedOption)] : "";
            const output = answer?.result ? [answer.result.stdout, answer.result.stderr].filter(Boolean).join("\n") : "";
            return `<section class="question"><div class="question-head"><div><span>Question ${question.number}</span><h4>${escapeHtml(question.title)}</h4></div><b>${answer ? "Answered" : "Unanswered"} · ${answer?.score ?? "--"}/${question.points}</b></div><p>${escapeHtml(question.prompt)}</p>${answer?.answerText ? `<label>Written answer</label><pre>${escapeHtml(answer.answerText)}</pre>` : ""}${selectedText ? `<label>Selected answer</label><pre>${escapeHtml(selectedText)}</pre>` : ""}${files}${answer?.stdinText ? `<label>Test input</label><pre>${escapeHtml(answer.stdinText)}</pre>` : ""}${files ? `<label>Latest test result</label><pre>${escapeHtml(output || (answer ? "Not run" : "No answer"))}</pre>` : ""}${answer?.feedback ? `<p class="feedback"><strong>Feedback:</strong> ${escapeHtml(answer.feedback)}</p>` : ""}</section>`;
          }).join("")}
          ${student.teacherFeedback ? `<p class="feedback overall"><strong>Overall feedback:</strong> ${escapeHtml(student.teacherFeedback)}</p>` : ""}
        </article>`).join("") : `<p class="empty">No students are registered for this session.</p>`}
    </section>`).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font:14px Georgia,serif;color:#17231d;margin:32px;background:#f5f2e9}main{max-width:1050px;margin:auto}.cover{padding:32px;background:#173a2d;color:white;border-radius:16px;margin-bottom:24px}.cover h1{margin:5px 0}.session,.student,.question{background:white;border:1px solid #d7ddd7;border-radius:14px;padding:20px;margin:16px 0}.session>header,.student-head,.question-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.session h2,.student h3,.question h4{margin:4px 0}.session p,.question p{line-height:1.5}.student{background:#fbfcf8}.question{border-left:5px solid #ca8444}.score{text-align:right;font-size:24px}.score small{display:block;font:11px Arial;color:#68736c}span,label{font:700 11px Arial;text-transform:uppercase;letter-spacing:.08em;color:#9a6537}pre{font:12px Consolas,monospace;white-space:pre-wrap;background:#17231d;color:#e8f3ec;padding:14px;border-radius:8px;overflow-wrap:anywhere}.file>strong{display:block;margin:10px 0 5px}.feedback{background:#eef4ef;padding:12px;border-radius:8px}.empty{padding:20px;text-align:center}@media print{body{margin:0;background:white}.cover,.session,.student,.question{break-inside:avoid}.student{break-before:auto}}</style></head><body><main><section class="cover"><span>EzProctor Exam</span><h1>${escapeHtml(title)}</h1><p>Exported ${escapeHtml(new Date().toLocaleString())}</p></section>${sections}</main></body></html>`;
}

function sendAnswerBook(res, groups, title, filename) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(answerBookHtml(groups, title));
}

function buildLobbyPayload({ session, student, registration }) {
  const startsAtMs = session.startsAt ? new Date(session.startsAt).getTime() : null;
  const calculatedEndsAt =
    Number.isFinite(startsAtMs)
      ? startsAtMs + Number(session.durationMinutes || 90) * 60000
      : null;
  const sessionExpired =
    session.status === "Closed" ||
    (Number.isFinite(calculatedEndsAt) && calculatedEndsAt <= Date.now());

  return {
    session: {
      id: session.id,
      examId: session.examId,
      sessionName: session.sessionName,
      examTitle: session.examTitle,
      accessCode: session.accessCode,
      durationMinutes: session.durationMinutes,
      status: session.status,
      expired: sessionExpired,
      language: session.language,
      testType: session.testType
    },
    student: {
      id: student.id,
      fullName: student.fullName,
      studentNumber: student.studentNumber,
      identityStatus: student.identityStatus
    },
    registration: registration
      ? {
          id: registration.id,
          seatLabel: registration.seatLabel || "",
          checkedIn: Boolean(registration.identityVerified),
          approvalStatus: registration.approvalStatus || "Pending",
          approvedAt: registration.approvedAt || null,
          lastLoginAt: registration.lastLoginAt || null
        }
      : null,
    canLaunch: session.status === "Active" && !sessionExpired
  };
}

function decodeXmlText(xml = "") {
  return String(xml)
    .replace(/<w:p[^>]*>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractDocumentText({ fileName, contentBase64 }) {
  const extension = path.extname(String(fileName || "")).toLowerCase();
  const buffer = Buffer.from(String(contentBase64 || ""), "base64");

  if (!buffer.length) {
    throw new Error("The uploaded file is empty.");
  }

  if ([".txt", ".md", ".csv", ".json"].includes(extension)) {
    return buffer.toString("utf8");
  }

  if (extension !== ".docx") {
    throw new Error("Please upload a .docx, .txt, .md, .csv, or .json file.");
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cloudide-docx-"));
  const archivePath = path.join(tempRoot, "source.docx");
  const extractDir = path.join(tempRoot, "unzipped");
  fs.writeFileSync(archivePath, buffer);
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        [
          "Add-Type -AssemblyName System.IO.Compression.FileSystem",
          `$source = '${archivePath.replace(/'/g, "''")}'`,
          `$target = '${extractDir.replace(/'/g, "''")}'`,
          "if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }",
          "[System.IO.Compression.ZipFile]::ExtractToDirectory($source, $target)"
        ].join("; ")
      ],
      { stdio: "ignore" }
    );
    const xmlPath = path.join(extractDir, "word", "document.xml");
    if (!fs.existsSync(xmlPath)) {
      throw new Error("Could not read the Word document body.");
    }
    return decodeXmlText(fs.readFileSync(xmlPath, "utf8"));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "cloudide-secure-backend" });
});

app.get("/api/dashboard/overview", (_req, res) => {
  res.json(overviewPayload());
});

app.get("/api/dashboard/submissions/:id", (req, res) => {
  const submission = getSubmissionById(req.params.id);
  if (!submission) {
    res.status(404).json({ error: "Submission not found" });
    return;
  }

  res.json(submission);
});

app.get("/api/dashboard/submissions/:id/answer-book.pdf", (req, res) => {
  const submission = getSubmissionById(req.params.id);
  if (!submission) return res.status(404).json({ error: "Submission not found" });
  const safeName = submission.fullName.replace(/[^a-z0-9-_]+/gi, "_");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}-${submission.id}-answers.pdf"`);
  createAnswerBookPdf(buildSubmissionAnswerBook(submission.id), `${submission.fullName} - ${submission.examTitle}`, res);
});

app.get("/api/dashboard/sessions/:id/answer-book", (req, res) => {
  const session = getSessionById(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  sendAnswerBook(res, buildAnswerBook({ sessionId: session.id }), `${session.sessionName} - Answer Book`, `session-${session.id}-answer-book.html`);
});

app.get("/api/dashboard/sessions/:id/answer-book.pdf", (req, res) => {
  const session = getSessionById(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="session-${session.id}-answer-backup.pdf"`);
  createAnswerBookPdf(buildAnswerBook({ sessionId: session.id }), `${session.sessionName} - Answer Backup`, res);
});

app.get("/api/dashboard/exams/:id/answer-book", (req, res) => {
  const exam = getExamById(req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found" });
  sendAnswerBook(res, buildAnswerBook({ examId: exam.id }), `${exam.title} - All Sessions Answer Book`, `exam-${exam.id}-answer-book.html`);
});

app.get("/api/dashboard/exams/:id/answer-book.pdf", (req, res) => {
  const exam = getExamById(req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="exam-${exam.id}-all-student-answers.pdf"`);
  createAnswerBookPdf(buildAnswerBook({ examId: exam.id }), `${exam.title} - All Student Answers`, res);
});

app.post("/api/dashboard/submissions/:id/questions/:questionId/grade", (req, res) => {
  const submission = getSubmissionById(req.params.id);
  if (!submission) {
    res.status(404).json({ error: "Submission not found" });
    return;
  }
  const answer = gradeQuestionAnswer(submission.sessionId, submission.studentId, req.params.questionId, {
    score: req.body.score,
    feedback: req.body.feedback,
    gradingStatus: req.body.gradingStatus || "Graded",
    examId: submission.examId
  });
  if (!answer) {
    res.status(404).json({ error: "Question answer not found" });
    return;
  }
  res.json(answer);
});

app.post("/api/dashboard/submissions/:id/grades", (req, res) => {
  const submission = getSubmissionById(req.params.id);
  if (!submission) return res.status(404).json({ error: "Submission not found" });
  const grades = Array.isArray(req.body.questionGrades) ? req.body.questionGrades : [];
  const questionById = new Map(submission.questionAnswers.map((answer) => [answer.questionId, answer]));
  for (const grade of grades) {
    const question = questionById.get(grade.questionId);
    if (!question) return res.status(400).json({ error: `Unknown question: ${grade.questionId}` });
    const score = grade.score === "" || grade.score === null || grade.score === undefined ? null : Number(grade.score);
    if (score !== null && (!Number.isFinite(score) || score < 0 || score > Number(question.points || 0))) {
      return res.status(400).json({ error: `Question ${question.questionNumber} mark must be between 0 and ${question.points}.` });
    }
  }
  const savedAnswers = grades.map((grade) => gradeQuestionAnswer(submission.sessionId, submission.studentId, grade.questionId, {
    score: grade.score,
    feedback: grade.feedback,
    gradingStatus: grade.gradingStatus || "Graded",
    examId: submission.examId
  }));
  const total = savedAnswers.reduce((sum, answer) => sum + Number(answer?.score || 0), 0);
  const savedSubmission = gradeSubmission(submission.id, {
    gradeScore: req.body.gradeScore === "" || req.body.gradeScore === undefined ? total : req.body.gradeScore,
    gradeStatus: req.body.gradeStatus || "Graded",
    teacherFeedback: req.body.teacherFeedback || ""
  });
  broadcast("submission-updated", savedSubmission);
  res.json(savedSubmission);
});

app.post("/api/dashboard/submissions/:id/questions/:questionId/suggest-grade", (req, res) => {
  const submission = getSubmissionById(req.params.id);
  if (!submission) return res.status(404).json({ error: "Submission not found" });
  const answer = submission.questionAnswers.find((item) => item.questionId === req.params.questionId);
  if (!answer) return res.status(404).json({ error: "Question answer not found" });
  res.json({ ...suggestQuestionGrade(answer, answer), questionId: answer.questionId, generatedAt: new Date().toISOString(), advisoryOnly: true });
});

app.post("/api/dashboard/submissions/:id/suggest-grades", (req, res) => {
  const submission = getSubmissionById(req.params.id);
  if (!submission) return res.status(404).json({ error: "Submission not found" });
  const suggestions = submission.questionAnswers
    .filter((answer) => answer.answered && answer.answerGuide)
    .map((answer) => ({
      ...suggestQuestionGrade(answer, answer),
      questionId: answer.questionId,
      questionNumber: answer.questionNumber,
      generatedAt: new Date().toISOString(),
      advisoryOnly: true
    }));
  res.json({ suggestions, advisoryOnly: true, message: "Suggestions are drafts until an educator saves each mark." });
});

app.post("/api/dashboard/submissions/:id/grade", (req, res) => {
  const submission = gradeSubmission(req.params.id, {
    gradeScore: req.body.gradeScore,
    gradeStatus: req.body.gradeStatus || "Reviewed",
    teacherFeedback: req.body.teacherFeedback || ""
  });

  if (!submission) {
    res.status(404).json({ error: "Submission not found" });
    return;
  }

  broadcast("submission-updated", submission);
  res.json(submission);
});

app.get("/api/dashboard/submissions/:id/download", (req, res) => {
  const submission = getSubmissionById(req.params.id);
  if (!submission) {
    res.status(404).json({ error: "Submission not found" });
    return;
  }

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${submission.fullName.replace(/[^a-z0-9-_]+/gi, "_")}-${submission.id}.json"`
  );
  res.send(
    JSON.stringify(
      {
        id: submission.id,
        student: {
          id: submission.studentId,
          name: submission.fullName,
          number: submission.studentNumber
        },
        exam: {
          id: submission.examId,
          title: submission.examTitle,
          language: submission.language,
          testType: submission.testType
        },
        session: {
          id: submission.sessionId,
          name: submission.sessionName
        },
        submittedAt: submission.submittedAt,
        status: submission.status,
        files: submission.files
      },
      null,
      2
    )
  );
});

app.post("/api/dashboard/exams", (req, res) => {
  const exam = createExam({
    id: req.body.id || `exam-${crypto.randomUUID().slice(0, 8)}`,
    ...req.body
  });
  broadcast("exam-created", exam);
  res.status(201).json(exam);
});

app.get("/api/dashboard/exams/:id", (req, res) => {
  const exam = getExamById(req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found" });
  res.json(exam);
});

app.put("/api/dashboard/exams/:id", (req, res) => {
  const exam = updateExam(req.params.id, req.body);
  if (!exam) return res.status(404).json({ error: "Exam not found" });
  broadcast("exam-updated", exam);
  res.json(exam);
});

app.post("/api/dashboard/exams/:id/model-answers/preview", (req, res) => {
  try {
    const exam = getExamById(req.params.id);
    if (!exam) return res.status(404).json({ error: "Exam not found" });
    const sourceText = extractDocumentText({ fileName: req.body.fileName, contentBase64: req.body.contentBase64 });
    const entries = parseModelAnswers({ fileName: req.body.fileName, sourceText });
    res.json({ ok: true, examId: exam.id, fileName: req.body.fileName, ...mapModelAnswers(exam, entries) });
  } catch (error) {
    res.status(400).json({ error: error.message || "Failed to map model answers." });
  }
});

app.post("/api/dashboard/exams/:id/model-answers/apply", (req, res) => {
  const exam = getExamById(req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found" });
  const requested = Array.isArray(req.body.matches) ? req.body.matches : [];
  const answerByQuestionId = new Map(requested
    .filter((match) => match.questionId && String(match.answerGuide || "").trim())
    .map((match) => [match.questionId, String(match.answerGuide).trim()]));
  const questions = exam.questions.map((question) => answerByQuestionId.has(question.id)
    ? { ...question, answerGuide: answerByQuestionId.get(question.id) }
    : question);
  const appliedCount = questions.filter((question, index) => question.answerGuide !== exam.questions[index].answerGuide).length;
  const updated = updateExam(exam.id, { questions });
  broadcast("exam-updated", updated);
  res.json({ ok: true, appliedCount, exam: updated });
});

app.post("/api/dashboard/questions/generate", async (req, res) => {
  try {
    const questions = await generateQuestionsWithAI({
      title: req.body.title,
      testType: req.body.testType,
      language: req.body.language,
      durationMinutes: Number(req.body.durationMinutes || 90),
      topic: req.body.topic,
      difficulty: req.body.difficulty,
      questionCount: Number(req.body.questionCount || 3),
      preferredFormats: Array.isArray(req.body.preferredFormats) ? req.body.preferredFormats : [],
      notes: req.body.notes
    });

    res.json({ ok: true, questions });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to generate questions." });
  }
});

app.post("/api/dashboard/questions/import-document", async (req, res) => {
  try {
    const sourceText = extractDocumentText({
      fileName: req.body.fileName,
      contentBase64: req.body.contentBase64
    });

    const result = await importQuestionsFromDocument({
      title: req.body.title,
      testType: req.body.testType,
      language: req.body.language,
      durationMinutes: Number(req.body.durationMinutes || 90),
      sourceText,
      questionCount: Number(req.body.questionCount || 4)
    });

      res.json({
        ok: true,
        questions: result.questions,
        summary: result.summary,
        metadata: result.metadata || null,
        mode: result.mode,
        fallbackReason: result.fallbackReason || null
      });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to import document." });
  }
});

app.post("/api/dashboard/sessions", (req, res) => {
  const session = createSession({
    id: req.body.id || `session-${crypto.randomUUID().slice(0, 8)}`,
    accessCode: req.body.accessCode || crypto.randomUUID().slice(0, 6).toUpperCase(),
    ...req.body
  });
  broadcast("session-created", session);
  res.status(201).json(session);
});

app.put("/api/dashboard/sessions/:id", (req, res) => {
  const session = updateSession(req.params.id, req.body);
  if (!session) return res.status(404).json({ error: "Session not found" });
  broadcast("session-updated", session);
  res.json(session);
});

app.post("/api/dashboard/students", (req, res) => {
  const student = createStudent({
    id: req.body.id || `student-${crypto.randomUUID().slice(0, 8)}`,
    ...req.body
  });
  broadcast("student-created", student);
  res.status(201).json(student);
});

app.put("/api/dashboard/students/:id", (req, res) => {
  const student = updateStudent(req.params.id, req.body);
  if (!student) return res.status(404).json({ error: "Student not found" });
  broadcast("student-updated", student);
  res.json(student);
});

app.delete("/api/dashboard/submissions/:id", (req, res) => {
  const deleted = deleteSubmission(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Student work not found" });
  broadcast("dashboard-bootstrap", overviewPayload());
  res.json({ ok: true, deleted });
});

app.post("/api/dashboard/students/import", (req, res) => {
  const imported = importStudents(req.body.students || []);
  broadcast("dashboard-bootstrap", overviewPayload());
  res.status(201).json({ ok: true, importedCount: imported.length, students: imported });
});

app.post("/api/dashboard/registrations", (req, res) => {
  const registration = createRegistration({
    id: req.body.id || `registration-${crypto.randomUUID().slice(0, 8)}`,
    verificationCode: req.body.verificationCode || crypto.randomUUID().slice(0, 6).toUpperCase(),
    ...req.body
  });
  broadcast("registration-created", registration);
  res.status(201).json(registration);
});

app.delete("/api/dashboard/exams/:id", (req, res) => {
  const deleted = deleteExam(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Exam not found" });
    return;
  }

  broadcast("dashboard-bootstrap", overviewPayload());
  res.json({ ok: true, deleted });
});

app.delete("/api/dashboard/sessions/:id", (req, res) => {
  const deleted = deleteSession(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  broadcast("dashboard-bootstrap", overviewPayload());
  res.json({ ok: true, deleted });
});

app.delete("/api/dashboard/students/:id", (req, res) => {
  const deleted = deleteStudent(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Student not found" });
    return;
  }

  broadcast("dashboard-bootstrap", overviewPayload());
  res.json({ ok: true, deleted });
});

app.post("/api/dashboard/registrations/:id/approve", (req, res) => {
  const registration = approveRegistration(req.params.id);
  if (!registration) {
    res.status(404).json({ error: "Registration not found" });
    return;
  }

  const session = listSessions().find((item) => item.id === registration.sessionId);
  const student = listStudents().find((item) => item.id === registration.studentId);
  if (session && student) {
    const snapshot = upsertSnapshot({
      sessionId: registration.sessionId,
      studentId: registration.studentId,
      studentName: student.fullName,
      examId: session.examId,
      currentActivity: session.status === "Active" ? "Approved and ready to launch" : "Approved, waiting for release",
      progress: 0,
      violations: 0,
      submitted: false
    });
    broadcast("student-snapshot", snapshot);
  }

  broadcast("registration-updated", registration);
  res.json(registration);
});

app.post("/api/dashboard/registrations/:id/revoke", (req, res) => {
  const registration = revokeRegistrationApproval(req.params.id);
  if (!registration) {
    res.status(404).json({ error: "Registration not found" });
    return;
  }

  const session = listSessions().find((item) => item.id === registration.sessionId);
  const student = listStudents().find((item) => item.id === registration.studentId);
  if (session && student) {
    const snapshot = upsertSnapshot({
      sessionId: registration.sessionId,
      studentId: registration.studentId,
      studentName: student.fullName,
      examId: session.examId,
      currentActivity: "Waiting for teacher approval",
      progress: 0,
      violations: 0,
      submitted: false
    });
    broadcast("student-snapshot", snapshot);
  }

  broadcast("registration-updated", registration);
  res.json(registration);
});

app.delete("/api/dashboard/registrations/:id", (req, res) => {
  const deleted = rejectRegistration(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Registration not found" });
    return;
  }

  broadcast("dashboard-bootstrap", overviewPayload());
  res.json({ ok: true, deleted });
});

app.post("/api/dashboard/sessions/:id/start", (req, res) => {
  const session = updateSessionStatus(req.params.id, "Active");
  broadcast("session-updated", session);
  res.json(session);
});

app.post("/api/dashboard/sessions/:id/stop", (req, res) => {
  const session = updateSessionStatus(req.params.id, "Closed");
  const createdSubmissions = finalizeSessionSubmissions(req.params.id);
  broadcast("session-updated", session);
  createdSubmissions.forEach((submission) => broadcast("submission-created", submission));
  res.json(session);
});

app.get("/api/exam/lobby/session", (_req, res) => {
  const session = getCurrentLobbySession();
  if (!session) {
    res.status(404).json({ error: "No scheduled or active exam session is available." });
    return;
  }

  res.json({
    id: session.id,
    examId: session.examId,
    sessionName: session.sessionName,
    examTitle: session.examTitle,
    accessCode: session.accessCode,
    durationMinutes: session.durationMinutes,
    status: session.status,
    language: session.language,
    testType: session.testType
  });
});

app.post("/api/exam/lobby/checkin", (req, res) => {
  const studentNumber = String(req.body.studentNumber || "").trim();
  const fullName = String(req.body.fullName || "").trim();
  const session = getCurrentLobbySession();

  if (!studentNumber || !fullName) {
    res.status(400).json({ error: "Student ID and full name are required." });
    return;
  }

  if (!session) {
    res.status(404).json({ error: "No scheduled or active exam session is available." });
    return;
  }

  let student = findStudentByNumber(studentNumber);
  if (!student) {
    res.status(403).json({ error: "This student is not registered in the system. Please contact your teacher." });
    return;
  }

  if (student.fullName.trim().toLowerCase() !== fullName.toLowerCase()) {
    res.status(409).json({ error: "Student ID exists, but the full name does not match the registered student." });
    return;
  }

  student = markStudentCheckedIn(student.id);

  let registration = findRegistration(session.id, student.id);
  if (!registration) {
    registration = createRegistration({
      id: `registration-${crypto.randomUUID().slice(0, 8)}`,
      sessionId: session.id,
      studentId: student.id,
      verificationCode: crypto.randomUUID().slice(0, 6).toUpperCase(),
      seatLabel: "Lobby"
    });
  }

  markRegistrationCheckedIn(registration.id);
  registration = findRegistration(session.id, student.id);

  const lobbyPayload = buildLobbyPayload({ session, student, registration });
  const snapshot = upsertSnapshot({
    sessionId: session.id,
    studentId: student.id,
    studentName: student.fullName,
    examId: session.examId,
    progress: 0,
    currentActivity: session.status === "Active" ? "Ready to launch exam" : "Waiting for teacher to start session",
    violations: 0,
    submitted: false
  });

  recordActivity({
    sessionId: session.id,
    studentId: student.id,
    examId: session.examId,
    eventType: "LOBBY_CHECKIN",
    payload: lobbyPayload
  });

  broadcast("student-snapshot", snapshot);
  res.json(lobbyPayload);
});

app.get("/api/exam/lobby/status", (req, res) => {
  const sessionId = String(req.query.sessionId || "").trim();
  const studentId = String(req.query.studentId || "").trim();

  if (!sessionId || !studentId) {
    res.status(400).json({ error: "sessionId and studentId are required." });
    return;
  }

  const session = listSessions().find((item) => item.id === sessionId);
  const student = listStudents().find((item) => item.id === studentId);
  const registration = findRegistration(sessionId, studentId);

  if (!session || !student || !registration) {
    res.status(404).json({ error: "Lobby record not found." });
    return;
  }

  res.json(buildLobbyPayload({ session, student, registration }));
});

app.post("/api/exam/authenticate", (_req, res) => {
  const session = getCurrentLobbySession() || getActiveSession();
  if (!session) {
    res.json({
      sessionId: "open-session",
      studentId: "open-student",
      studentName: "Open Student",
      studentNumber: "OPEN001",
      examId: "open-exam",
      sessionName: "Open IDE Session",
      accessCode: ""
    });
    return;
  }

  res.json({
    sessionId: session.id,
    studentId: "open-student",
    studentName: "Open Student",
    studentNumber: "OPEN001",
    examId: session.examId,
    sessionName: session.sessionName,
    accessCode: session.accessCode
  });
});

app.get("/api/exam/timer", (req, res) => {
  res.json(getOpenTimer(String(req.query.sessionId || "")));
});

app.get("/api/exam/workspace", (req, res) => {
  const identity = ensureOpenIdentity(req);
  const session = getSessionById(identity.sessionId) || null;
  const effectiveExamId = session?.examId || identity.examId;
  const exam = getExamById(effectiveExamId) || null;
  const requestedLanguage = req.query.language || exam?.language;
  const { language, defaultFiles } = getRuntimeDefaults(identity, requestedLanguage);
  const workspace = getWorkspace(identity.sessionId, identity.studentId, effectiveExamId, defaultFiles, language);
  const questionId = String(req.query.questionId || "").trim();
  const questionAnswer = questionId ? getQuestionAnswer(identity.sessionId, identity.studentId, questionId) : null;
  if (questionAnswer) {
    const question = exam?.questions?.find((item) => item.id === questionId);
    const codingQuestion = /coding|debug|frontend/i.test(String(question?.format || ""));
    workspace.files = codingQuestion ? questionAnswer.files : questionAnswer.scratchFiles;
    workspace.lastRun = codingQuestion ? questionAnswer.result : questionAnswer.scratchResult;
  }
  const files = mapRuntimeFiles(language, workspace.files, defaultFiles);
  if (JSON.stringify(files) !== JSON.stringify(workspace.files)) {
    saveWorkspace(identity.sessionId, identity.studentId, effectiveExamId, files, {
      language,
      recordType: "SYSTEM_NORMALIZED",
      deduplicate: true
    });
  }
  res.json({
    ...workspace,
    files,
    exam,
    session,
    questionAnswer
  });
});

app.post("/api/exam/workspace", (req, res) => {
  const identity = ensureOpenIdentity(req);
  const { language, defaultFiles } = getRuntimeDefaults(identity, req.body.language);
  const files = mapRuntimeFiles(language, req.body.files, defaultFiles);
  const allowedRecordTypes = new Set([
    "AUTOSAVE", "MANUAL_SAVE", "FILE_ADDED", "FILE_RENAMED", "BEFORE_RUN",
    "BEFORE_SUBMIT", "TIMER_SUBMIT", "EXIT_SAVE"
  ]);
  const requestedRecordType = String(req.body.recordType || "AUTOSAVE").toUpperCase();
  const recordType = allowedRecordTypes.has(requestedRecordType) ? requestedRecordType : "AUTOSAVE";
  const workspace = saveWorkspace(identity.sessionId, identity.studentId, identity.examId, files, {
    language,
    recordType,
    deduplicate: recordType === "AUTOSAVE",
    metadata: { activeFile: String(req.body.activeFile || "") }
  });
  const questionId = String(req.body.questionId || "").trim();
  const questionAnswer = questionId ? saveQuestionAnswer({
    sessionId: identity.sessionId,
    studentId: identity.studentId,
    examId: identity.examId,
    questionId,
    files: req.body.answerMode === "text" ? {} : files,
    stdin: req.body.stdin || "",
    answerText: req.body.answerText || "",
    selectedOption: req.body.selectedOption || "",
    scratchFiles: req.body.answerMode === "text" ? files : {},
    scratchStdin: req.body.answerMode === "text" ? req.body.stdin || "" : ""
  }) : null;
  recordActivity({
    sessionId: identity.sessionId,
    studentId: identity.studentId,
    examId: identity.examId,
    eventType: "WORKSPACE_SAVED",
    payload: {
      fileCount: Object.keys(files).length,
      recordType,
      questionId: questionId || null
    }
  });

  const session = upsertSnapshot({
    ...req.body,
    ...identity,
    currentActivity: "Editing workspace"
  });
  broadcast("student-snapshot", session);
  res.json({ ...workspace, questionAnswer });
});

app.post("/api/exam/event", (req, res) => {
  const identity = ensureOpenIdentity(req);
  const payload = { ...req.body, ...identity };
  const updated = addEvent(payload);
  recordActivity({
    sessionId: identity.sessionId,
    studentId: identity.studentId,
    examId: identity.examId,
    eventType: payload.event,
    payload
  });
  broadcast("student-event", updated);
  res.status(202).json({ accepted: true, session: updated });
});

app.post("/api/exam/snapshot", (req, res) => {
  const identity = ensureOpenIdentity(req);
  const payload = { ...req.body, ...identity };
  const updated = upsertSnapshot(payload);
  recordActivity({
    sessionId: identity.sessionId,
    studentId: identity.studentId,
    examId: identity.examId,
    eventType: "SNAPSHOT",
    payload: {
      currentActivity: payload.currentActivity,
      progress: payload.progress
    }
  });
  broadcast("student-snapshot", updated);
  res.status(202).json({ accepted: true, session: updated });
});

app.post("/api/exam/run", async (req, res) => {
  const identity = ensureOpenIdentity(req);
  const { language, defaultFiles } = getRuntimeDefaults(identity, req.body.language);
  const files = mapRuntimeFiles(language, req.body.files, defaultFiles);
  saveWorkspace(identity.sessionId, identity.studentId, identity.examId, files, { record: false });
  const result = await runWorkspaceByLanguage(language, files, req.body.stdin || "");
  result.language = language;
  setLastRun(identity.sessionId, identity.studentId, result);
  saveWorkspace(identity.sessionId, identity.studentId, identity.examId, files, { record: false });
  const questionId = String(req.body.questionId || "").trim();
  const questionAnswer = questionId ? saveQuestionAnswer({
    sessionId: identity.sessionId,
    studentId: identity.studentId,
    examId: identity.examId,
    questionId,
    files: req.body.answerMode === "text" ? {} : files,
    stdin: req.body.stdin || "",
    result,
    answerText: req.body.answerText || "",
    selectedOption: req.body.selectedOption || "",
    scratchFiles: req.body.answerMode === "text" ? files : {},
    scratchStdin: req.body.answerMode === "text" ? req.body.stdin || "" : "",
    scratchResult: req.body.answerMode === "text" ? result : undefined
  }) : null;

  recordActivity({
    sessionId: identity.sessionId,
    studentId: identity.studentId,
    examId: identity.examId,
    eventType: result.ok ? "RUN_CODE" : "RUN_ERROR",
    payload: { ...result, questionId }
  });

  const session = addEvent({
    ...req.body,
    ...identity,
    event: result.ok ? "RUN_CODE" : "RUN_ERROR",
    progress: 60
  });

  broadcast("student-event", session);
  res.json({ ...result, questionAnswer });
});

app.post("/api/exam/submit", (req, res) => {
  const identity = ensureOpenIdentity(req);
  const { language, defaultFiles } = getRuntimeDefaults(identity, req.body.language);
  const files = mapRuntimeFiles(language, req.body.files, defaultFiles);
  saveWorkspace(identity.sessionId, identity.studentId, identity.examId, files, { record: false });

  const submission = recordSubmission({
    id: `submission-${crypto.randomUUID().slice(0, 8)}`,
    sessionId: identity.sessionId,
    studentId: identity.studentId,
    examId: identity.examId,
    files,
    language
  });

  const session = markSubmitted({
    ...req.body,
    ...identity
  });
  recordActivity({
    sessionId: identity.sessionId,
    studentId: identity.studentId,
    examId: identity.examId,
    eventType: "SUBMITTED",
    payload: submission
  });

  broadcast("student-event", session);
  broadcast("submission-created", submission);
  res.json({
    accepted: true,
    submission,
    session
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname !== "/ws") return socket.destroy();
  if (!activationStatus().activated) {
    socket.write("HTTP/1.1 402 Payment Required\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  if (!validEducatorSession(request)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (webSocket) => wss.emit("connection", webSocket, request));
});

function broadcast(type, payload) {
  const message = JSON.stringify({ type, payload });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

wss.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      type: "dashboard-bootstrap",
      payload: overviewPayload()
    })
  );
});

let startedServer = null;

function startServer(listenPort = port) {
  if (startedServer) {
    return startedServer;
  }

  startedServer = server.listen(listenPort, () => {
    console.log(`EzProctor Exam backend listening on http://localhost:${listenPort}`);
  });

  return startedServer;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer
};
