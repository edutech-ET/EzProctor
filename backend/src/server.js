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
const {
  approveRegistration,
  createExam,
  createRegistration,
  createSession,
  createStudent,
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

app.use(cors({ origin: [dashboardOrigin, true] }));
app.use(express.json({ limit: "12mb" }));
app.use(express.static(publicDir));

app.get("/", (_req, res) => {
  res.sendFile(path.resolve(publicDir, "index.html"));
});

app.get("/exam-mode", (_req, res) => {
  res.sendFile(path.resolve(publicDir, "exam-mode.html"));
});

app.get("/ide", (_req, res) => {
  res.sendFile(path.resolve(publicDir, "ide.html"));
});

app.get("/admin", (_req, res) => {
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
  return runPythonWorkspace(files, stdin);
}

function buildLobbyPayload({ session, student, registration }) {
  return {
    session: {
      id: session.id,
      examId: session.examId,
      sessionName: session.sessionName,
      examTitle: session.examTitle,
      accessCode: session.accessCode,
      durationMinutes: session.durationMinutes,
      status: session.status,
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
    canLaunch: session.status === "Active"
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

  if (extension === ".txt" || extension === ".md") {
    return buffer.toString("utf8");
  }

  if (extension !== ".docx") {
    throw new Error("Please upload a .docx, .txt, or .md file.");
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

app.post("/api/dashboard/students", (req, res) => {
  const student = createStudent({
    id: req.body.id || `student-${crypto.randomUUID().slice(0, 8)}`,
    ...req.body
  });
  broadcast("student-created", student);
  res.status(201).json(student);
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

app.get("/api/exam/timer", (_req, res) => {
  res.json(getOpenTimer());
});

app.get("/api/exam/workspace", (req, res) => {
  const identity = ensureOpenIdentity(req);
  const session = getSessionById(identity.sessionId) || null;
  const effectiveExamId = session?.examId || identity.examId;
  const exam = getExamById(effectiveExamId) || null;
  const requestedLanguage = req.query.language || exam?.language;
  const { language, defaultFiles } = getRuntimeDefaults(identity, requestedLanguage);
  const workspace = getWorkspace(identity.sessionId, identity.studentId, effectiveExamId, defaultFiles);
  const files = mapRuntimeFiles(language, workspace.files, defaultFiles);
  if (JSON.stringify(files) !== JSON.stringify(workspace.files)) {
    saveWorkspace(identity.sessionId, identity.studentId, effectiveExamId, files);
  }
  res.json({
    ...workspace,
    files,
    exam,
    session
  });
});

app.post("/api/exam/workspace", (req, res) => {
  const identity = ensureOpenIdentity(req);
  const { language, defaultFiles } = getRuntimeDefaults(identity, req.body.language);
  const files = mapRuntimeFiles(language, req.body.files, defaultFiles);
  const workspace = saveWorkspace(identity.sessionId, identity.studentId, identity.examId, files);
  recordActivity({
    sessionId: identity.sessionId,
    studentId: identity.studentId,
    examId: identity.examId,
    eventType: "WORKSPACE_SAVED",
    payload: { fileCount: Object.keys(files).length }
  });

  const session = upsertSnapshot({
    ...req.body,
    ...identity,
    currentActivity: "Editing workspace"
  });
  broadcast("student-snapshot", session);
  res.json(workspace);
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
  saveWorkspace(identity.sessionId, identity.studentId, identity.examId, files);
  const result = await runWorkspaceByLanguage(language, files, req.body.stdin || "");
  result.language = language;
  setLastRun(identity.sessionId, identity.studentId, result);

  recordActivity({
    sessionId: identity.sessionId,
    studentId: identity.studentId,
    examId: identity.examId,
    eventType: result.ok ? "RUN_CODE" : "RUN_ERROR",
    payload: result
  });

  const session = addEvent({
    ...req.body,
    ...identity,
    event: result.ok ? "RUN_CODE" : "RUN_ERROR",
    progress: 60
  });

  broadcast("student-event", session);
  res.json(result);
});

app.post("/api/exam/submit", (req, res) => {
  const identity = ensureOpenIdentity(req);
  const { language, defaultFiles } = getRuntimeDefaults(identity, req.body.language);
  const files = mapRuntimeFiles(language, req.body.files, defaultFiles);
  saveWorkspace(identity.sessionId, identity.studentId, identity.examId, files);

  const submission = recordSubmission({
    id: `submission-${crypto.randomUUID().slice(0, 8)}`,
    sessionId: identity.sessionId,
    studentId: identity.studentId,
    examId: identity.examId,
    files
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
const wss = new WebSocketServer({ server, path: "/ws" });

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
    console.log(`CloudIDE Secure backend listening on http://localhost:${listenPort}`);
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
