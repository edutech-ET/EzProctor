const { calculateRisk, deriveSignals, deriveStatus } = require("./riskEngine");

const sessions = new Map();

function ensureSession(studentId, payload = {}) {
  if (!sessions.has(studentId)) {
    sessions.set(studentId, {
      studentId,
      studentName: payload.studentName || "Unknown Student",
      examId: payload.examId || "unknown-exam",
      progress: 0,
      currentActivity: "Starting exam",
      violations: 0,
      riskScore: 0,
      status: "Normal",
      submitted: false,
      submittedAt: null,
      signals: [],
      updatedAt: new Date().toISOString(),
      events: []
    });
  }

  return sessions.get(studentId);
}

function addEvent(payload) {
  const session = ensureSession(payload.studentId, payload);
  const event = {
    type: payload.event,
    timestamp: payload.timestamp || Date.now(),
    metadata: payload.metadata || {}
  };

  session.studentName = payload.studentName || session.studentName;
  session.examId = payload.examId || session.examId;
  session.currentActivity = payload.event;
  session.progress =
    typeof payload.progress === "number" ? Math.max(0, Math.min(payload.progress, 100)) : session.progress;
  session.events.push(event);
  session.violations = session.events.filter((item) => item.type !== "HEARTBEAT").length;
  session.riskScore = calculateRisk(session.events);
  session.status = deriveStatus(session.riskScore);
  session.signals = deriveSignals(session.events);
  session.updatedAt = new Date().toISOString();

  return {
    ...session,
    events: [...session.events]
  };
}

function upsertSnapshot(payload) {
  const session = ensureSession(payload.studentId, payload);
  session.studentName = payload.studentName || session.studentName;
  session.examId = payload.examId || session.examId;
  session.currentActivity = payload.currentActivity || session.currentActivity;
  session.progress =
    typeof payload.progress === "number" ? Math.max(0, Math.min(payload.progress, 100)) : session.progress;
  session.signals = deriveSignals(session.events);
  session.updatedAt = new Date().toISOString();

  return {
    ...session,
    events: [...session.events]
  };
}

function listSessions() {
  return [...sessions.values()].map((session) => ({
    ...session,
    events: [...session.events]
  }));
}

function markSubmitted(payload) {
  const session = ensureSession(payload.studentId, payload);
  session.studentName = payload.studentName || session.studentName;
  session.examId = payload.examId || session.examId;
  session.currentActivity = "Submitted";
  session.submitted = true;
  session.submittedAt = new Date().toISOString();
  session.signals = deriveSignals(session.events);
  session.updatedAt = session.submittedAt;

  return {
    ...session,
    events: [...session.events]
  };
}

module.exports = {
  addEvent,
  markSubmitted,
  upsertSnapshot,
  listSessions
};
