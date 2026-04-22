const crypto = require("crypto");

const exams = [
  {
    id: "exam-001",
    title: "Python Secure Coding Exam",
    language: "Python",
    durationMinutes: 90,
    status: "Draft",
    createdAt: new Date().toISOString()
  }
];

const sessions = [
  {
    id: "session-001",
    examId: "exam-001",
    sessionName: "Morning Lab",
    accessCode: "PY-SEC-001",
    studentCount: 30,
    status: "Scheduled",
    createdAt: new Date().toISOString()
  }
];

function listExams() {
  return [...exams];
}

function listAdminSessions() {
  return [...sessions];
}

function createExam(payload) {
  const exam = {
    id: payload.id || `exam-${crypto.randomUUID().slice(0, 8)}`,
    title: payload.title,
    language: payload.language || "Python",
    durationMinutes: Number(payload.durationMinutes || 90),
    status: payload.status || "Draft",
    createdAt: new Date().toISOString()
  };

  exams.unshift(exam);
  return exam;
}

function createSession(payload) {
  const session = {
    id: payload.id || `session-${crypto.randomUUID().slice(0, 8)}`,
    examId: payload.examId,
    sessionName: payload.sessionName,
    accessCode: payload.accessCode || crypto.randomUUID().slice(0, 6).toUpperCase(),
    studentCount: Number(payload.studentCount || 0),
    status: payload.status || "Scheduled",
    createdAt: new Date().toISOString()
  };

  sessions.unshift(session);
  return session;
}

module.exports = {
  listExams,
  listAdminSessions,
  createExam,
  createSession
};

