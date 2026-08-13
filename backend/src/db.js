const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const dataDir = process.env.CLOUDIDE_SECURE_DATA_DIR
  ? path.resolve(process.env.CLOUDIDE_SECURE_DATA_DIR)
  : path.resolve(__dirname, "..", "data");
const dbPath = path.join(dataDir, "cloudide-secure.db");

fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS exams (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    test_type TEXT NOT NULL DEFAULT 'Coding',
    language TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    questions_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS exam_sessions (
    id TEXT PRIMARY KEY,
    exam_id TEXT NOT NULL,
    session_name TEXT NOT NULL,
    access_code TEXT NOT NULL UNIQUE,
    student_count INTEGER NOT NULL,
    status TEXT NOT NULL,
    starts_at TEXT,
    ends_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    student_number TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    email TEXT,
    identity_status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS registrations (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    verification_code TEXT NOT NULL,
    seat_label TEXT,
    identity_verified INTEGER NOT NULL DEFAULT 0,
    approval_status TEXT NOT NULL DEFAULT 'Pending',
    approved_at TEXT,
    last_login_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(session_id, student_id)
  );

  CREATE TABLE IF NOT EXISTS workspaces (
    session_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    exam_id TEXT NOT NULL,
    files_json TEXT NOT NULL,
    last_run_json TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(session_id, student_id)
  );

  CREATE TABLE IF NOT EXISTS workspace_recordings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    exam_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    record_type TEXT NOT NULL,
    language TEXT,
    files_json TEXT NOT NULL,
    stdin_text TEXT,
    result_json TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    content_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(session_id, student_id, version_number)
  );

  CREATE INDEX IF NOT EXISTS idx_workspace_recordings_student
  ON workspace_recordings(session_id, student_id, created_at);

  CREATE INDEX IF NOT EXISTS idx_workspace_recordings_exam
  ON workspace_recordings(exam_id, created_at);

  CREATE TABLE IF NOT EXISTS question_answers (
    session_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    exam_id TEXT NOT NULL,
    question_id TEXT NOT NULL,
    files_json TEXT NOT NULL,
    stdin_text TEXT NOT NULL DEFAULT '',
    result_json TEXT,
    answer_text TEXT NOT NULL DEFAULT '',
    selected_option TEXT NOT NULL DEFAULT '',
    scratch_files_json TEXT NOT NULL DEFAULT '{}',
    scratch_stdin_text TEXT NOT NULL DEFAULT '',
    scratch_result_json TEXT,
    score REAL,
    feedback TEXT NOT NULL DEFAULT '',
    grading_status TEXT NOT NULL DEFAULT 'Pending',
    updated_at TEXT NOT NULL,
    graded_at TEXT,
    PRIMARY KEY(session_id, student_id, question_id)
  );

  CREATE INDEX IF NOT EXISTS idx_question_answers_exam
  ON question_answers(exam_id, session_id, student_id);

  CREATE TABLE IF NOT EXISTS activity_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    student_id TEXT,
    exam_id TEXT,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    exam_id TEXT NOT NULL,
    files_json TEXT NOT NULL,
    submitted_at TEXT NOT NULL,
    status TEXT NOT NULL,
    grade_score REAL,
    grade_status TEXT NOT NULL DEFAULT 'Pending Review',
    teacher_feedback TEXT,
    reviewed_at TEXT
  );
`);

const questionAnswerColumns = db.prepare(`PRAGMA table_info(question_answers)`).all();
if (!questionAnswerColumns.some((column) => column.name === "answer_text")) {
  db.exec(`ALTER TABLE question_answers ADD COLUMN answer_text TEXT NOT NULL DEFAULT '';`);
}
if (!questionAnswerColumns.some((column) => column.name === "selected_option")) {
  db.exec(`ALTER TABLE question_answers ADD COLUMN selected_option TEXT NOT NULL DEFAULT '';`);
}
if (!questionAnswerColumns.some((column) => column.name === "scratch_files_json")) {
  db.exec(`ALTER TABLE question_answers ADD COLUMN scratch_files_json TEXT NOT NULL DEFAULT '{}';`);
}
if (!questionAnswerColumns.some((column) => column.name === "scratch_stdin_text")) {
  db.exec(`ALTER TABLE question_answers ADD COLUMN scratch_stdin_text TEXT NOT NULL DEFAULT '';`);
}
if (!questionAnswerColumns.some((column) => column.name === "scratch_result_json")) {
  db.exec(`ALTER TABLE question_answers ADD COLUMN scratch_result_json TEXT;`);
}

const examColumns = db.prepare(`PRAGMA table_info(exams)`).all();
if (!examColumns.some((column) => column.name === "test_type")) {
  db.exec(`ALTER TABLE exams ADD COLUMN test_type TEXT NOT NULL DEFAULT 'Coding';`);
}
if (!examColumns.some((column) => column.name === "questions_json")) {
  db.exec(`ALTER TABLE exams ADD COLUMN questions_json TEXT NOT NULL DEFAULT '[]';`);
}

const registrationColumns = db.prepare(`PRAGMA table_info(registrations)`).all();
if (!registrationColumns.some((column) => column.name === "approval_status")) {
  db.exec(`ALTER TABLE registrations ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'Pending';`);
}
if (!registrationColumns.some((column) => column.name === "approved_at")) {
  db.exec(`ALTER TABLE registrations ADD COLUMN approved_at TEXT;`);
}

const submissionColumns = db.prepare(`PRAGMA table_info(submissions)`).all();
if (!submissionColumns.some((column) => column.name === "grade_score")) {
  db.exec(`ALTER TABLE submissions ADD COLUMN grade_score REAL;`);
}
if (!submissionColumns.some((column) => column.name === "grade_status")) {
  db.exec(`ALTER TABLE submissions ADD COLUMN grade_status TEXT NOT NULL DEFAULT 'Pending Review';`);
}
if (!submissionColumns.some((column) => column.name === "teacher_feedback")) {
  db.exec(`ALTER TABLE submissions ADD COLUMN teacher_feedback TEXT;`);
}
if (!submissionColumns.some((column) => column.name === "reviewed_at")) {
  db.exec(`ALTER TABLE submissions ADD COLUMN reviewed_at TEXT;`);
}

function now() {
  return new Date().toISOString();
}

function safeJsonParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_error) {
    return fallback;
  }
}

function normalizeQuestions(questions = []) {
  return (Array.isArray(questions) ? questions : [])
    .map((question, index) => {
      const format = String(question?.format || "Coding").trim() || "Coding";
      const title = String(question?.title || `${format} Question ${index + 1}`).trim();
      const prompt = String(question?.prompt || "").trim();
      const points = Number(question?.points || 10);
      const options = Array.isArray(question?.options)
        ? question.options.map((option) => String(option || "").trim()).filter(Boolean)
        : [];

        return {
          id: String(question?.id || `question-${index + 1}`),
          number: index + 1,
          format,
          title,
          section: String(question?.section || "").trim(),
          prompt,
          points: Number.isFinite(points) && points > 0 ? points : 10,
          options,
        starter: String(question?.starter || "").trim(),
        answerGuide: String(question?.answerGuide || "").trim()
      };
    })
    .filter((question) => question.title && question.prompt);
}

function listExams() {
  return db.prepare(`
    SELECT id, title, test_type AS testType, language, duration_minutes AS durationMinutes,
           questions_json AS questionsJson, status, created_at AS createdAt
    FROM exams
    ORDER BY created_at DESC
  `).all().map(({ questionsJson, ...row }) => ({
    ...row,
    questions: safeJsonParse(questionsJson, [])
  }));
}

function getExamById(id) {
  const row = db.prepare(`
    SELECT id, title, test_type AS testType, language, duration_minutes AS durationMinutes,
           questions_json AS questionsJson, status, created_at AS createdAt
    FROM exams
    WHERE id = ?
  `).get(id);

  const { questionsJson, ...exam } = row || {};
  return row
    ? {
        ...exam,
        questions: safeJsonParse(questionsJson, [])
      }
    : null;
}

function createExam({
  id,
  title,
  testType = "Coding",
  language = "Python",
  durationMinutes = 90,
  questions = [],
  status = "Draft"
}) {
  const createdAt = now();
  const normalizedQuestions = normalizeQuestions(questions);
  db.prepare(`
    INSERT INTO exams (id, title, test_type, language, duration_minutes, questions_json, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    title,
    testType,
    language,
    Number(durationMinutes),
    JSON.stringify(normalizedQuestions),
    status,
    createdAt
  );

  const row = db.prepare(`
    SELECT id, title, test_type AS testType, language, duration_minutes AS durationMinutes,
           questions_json AS questionsJson, status, created_at AS createdAt
    FROM exams WHERE id = ?
  `).get(id);

  const { questionsJson, ...exam } = row || {};
  return {
    ...exam,
    questions: safeJsonParse(questionsJson, [])
  };
}

function updateExam(id, payload = {}) {
  const current = getExamById(id);
  if (!current) return null;
  const questions = payload.questions === undefined ? current.questions : normalizeQuestions(payload.questions);
  db.prepare(`UPDATE exams SET title = ?, test_type = ?, language = ?, duration_minutes = ?, questions_json = ?, status = ? WHERE id = ?`).run(
    payload.title ?? current.title, payload.testType ?? current.testType, payload.language ?? current.language,
    Number(payload.durationMinutes ?? current.durationMinutes), JSON.stringify(questions), payload.status ?? current.status, id
  );
  return getExamById(id);
}

function sessionEndTime(startsAt, durationMinutes) {
  if (!startsAt) {
    return null;
  }

  const startMs = new Date(startsAt).getTime();
  if (!Number.isFinite(startMs)) {
    return null;
  }

  return new Date(startMs + Number(durationMinutes || 90) * 60000).toISOString();
}

function expireStaleSessions() {
  const activeSessions = db.prepare(`
    SELECT es.id, es.starts_at AS startsAt, e.duration_minutes AS durationMinutes
    FROM exam_sessions es
    JOIN exams e ON e.id = es.exam_id
    WHERE es.status = 'Active' AND es.starts_at IS NOT NULL
  `).all();

  const closeSession = db.prepare(`
    UPDATE exam_sessions
    SET status = 'Closed', ends_at = ?
    WHERE id = ? AND status = 'Active'
  `);

  activeSessions.forEach((session) => {
    const endsAt = sessionEndTime(session.startsAt, session.durationMinutes);
    if (endsAt && new Date(endsAt).getTime() <= Date.now()) {
      closeSession.run(endsAt, session.id);
    }
  });
}

function listSessions() {
  expireStaleSessions();
  return db.prepare(`
    SELECT es.id, es.exam_id AS examId, es.session_name AS sessionName, es.access_code AS accessCode,
           es.student_count AS studentCount, es.status, es.starts_at AS startsAt, es.ends_at AS endsAt,
           es.created_at AS createdAt, e.duration_minutes AS durationMinutes, e.title AS examTitle,
           e.test_type AS testType, e.language
    FROM exam_sessions es
    JOIN exams e ON e.id = es.exam_id
    ORDER BY es.created_at DESC
  `).all();
}

function getSessionById(id) {
  return db.prepare(`
    SELECT es.id, es.exam_id AS examId, es.session_name AS sessionName, es.access_code AS accessCode,
           es.student_count AS studentCount, es.status, es.starts_at AS startsAt, es.ends_at AS endsAt,
           es.created_at AS createdAt, e.duration_minutes AS durationMinutes, e.title AS examTitle,
           e.test_type AS testType, e.language
    FROM exam_sessions es
    JOIN exams e ON e.id = es.exam_id
    WHERE es.id = ?
  `).get(id);
}

function createSession({ id, examId, sessionName, accessCode, studentCount = 0, status = "Scheduled" }) {
  const createdAt = now();
  db.prepare(`
    INSERT INTO exam_sessions (id, exam_id, session_name, access_code, student_count, status, starts_at, ends_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)
  `).run(id, examId, sessionName, accessCode, Number(studentCount), status, createdAt);

  return db.prepare(`
    SELECT es.id, es.exam_id AS examId, es.session_name AS sessionName, es.access_code AS accessCode,
           es.student_count AS studentCount, es.status, es.starts_at AS startsAt, es.ends_at AS endsAt,
           es.created_at AS createdAt, e.duration_minutes AS durationMinutes, e.title AS examTitle,
           e.test_type AS testType, e.language
    FROM exam_sessions es
    JOIN exams e ON e.id = es.exam_id
    WHERE es.id = ?
  `).get(id);
}

function updateSession(id, payload = {}) {
  const current = getSessionById(id);
  if (!current) return null;
  db.prepare(`UPDATE exam_sessions SET exam_id = ?, session_name = ?, access_code = ?, student_count = ? WHERE id = ?`).run(
    payload.examId ?? current.examId, payload.sessionName ?? current.sessionName,
    payload.accessCode ?? current.accessCode, Number(payload.studentCount ?? current.studentCount), id
  );
  return getSessionById(id);
}

function updateSessionStatus(id, status) {
  if (status === "Active") {
    const startedAt = now();
    db.prepare(`
      UPDATE exam_sessions
      SET status = 'Closed', ends_at = ?
      WHERE status = 'Active' AND id <> ?
    `).run(startedAt, id);
    db.prepare(`
      UPDATE exam_sessions
      SET status = 'Active', starts_at = ?, ends_at = NULL
      WHERE id = ?
    `).run(startedAt, id);
  } else if (status === "Closed") {
    db.prepare(`
      UPDATE exam_sessions
      SET status = 'Closed', ends_at = ?
      WHERE id = ?
    `).run(now(), id);
  } else {
    db.prepare(`
      UPDATE exam_sessions
      SET status = ?
      WHERE id = ?
    `).run(status, id);
  }

  return db.prepare(`
    SELECT es.id, es.exam_id AS examId, es.session_name AS sessionName, es.access_code AS accessCode,
           es.student_count AS studentCount, es.status, es.starts_at AS startsAt, es.ends_at AS endsAt,
           es.created_at AS createdAt, e.duration_minutes AS durationMinutes, e.title AS examTitle,
           e.test_type AS testType, e.language
    FROM exam_sessions es
    JOIN exams e ON e.id = es.exam_id
    WHERE es.id = ?
  `).get(id);
}

function getOpenTimer(sessionId = "") {
  const requestedSession =
    sessionId && sessionId !== "open-session" ? getSessionById(sessionId) : null;
  const activeSession = requestedSession || getActiveSession();

  const latestExam = db.prepare(`
    SELECT id AS examId, title AS examTitle, test_type AS testType, duration_minutes AS durationMinutes
    FROM exams
    ORDER BY created_at DESC
    LIMIT 1
  `).get();

  const source = activeSession || latestExam || {
    examId: "open-exam",
    examTitle: "Open IDE Session",
    testType: "Coding",
    durationMinutes: 90
  };

  const startsAt = source.startsAt || now();
  const durationMinutes = Number(source.durationMinutes || 90);
  const endsAt =
    source.endsAt || new Date(new Date(startsAt).getTime() + durationMinutes * 60000).toISOString();
  const remainingSeconds = Math.max(0, Math.floor((new Date(endsAt).getTime() - Date.now()) / 1000));

  return {
    sessionId: source.id || "open-session",
    examId: source.examId || "open-exam",
    examTitle: source.examTitle || "Open IDE Session",
    sessionName: source.sessionName || "Open IDE Session",
    testType: source.testType || "Coding",
    startsAt,
    endsAt,
    durationMinutes,
    remainingSeconds,
    expired: remainingSeconds <= 0
  };
}

function getActiveSession() {
  expireStaleSessions();
  return db.prepare(`
    SELECT es.id, es.exam_id AS examId, es.session_name AS sessionName, es.status,
           es.starts_at AS startsAt, es.ends_at AS endsAt, e.duration_minutes AS durationMinutes,
           e.title AS examTitle, e.test_type AS testType
    FROM exam_sessions es
    JOIN exams e ON e.id = es.exam_id
    WHERE es.status = 'Active'
    ORDER BY es.starts_at DESC, es.created_at DESC
    LIMIT 1
  `).get();
}

function listStudents() {
  return db.prepare(`
    SELECT id, student_number AS studentNumber, full_name AS fullName, email, identity_status AS identityStatus,
           created_at AS createdAt
    FROM students
    ORDER BY created_at DESC
  `).all();
}

function createStudent({ id, studentNumber, fullName, email = "", identityStatus = "Pending" }) {
  const createdAt = now();
  db.prepare(`
    INSERT INTO students (id, student_number, full_name, email, identity_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, studentNumber, fullName, email, identityStatus, createdAt);

  return db.prepare(`
    SELECT id, student_number AS studentNumber, full_name AS fullName, email, identity_status AS identityStatus,
           created_at AS createdAt
    FROM students WHERE id = ?
  `).get(id);
}

function updateStudent(id, payload = {}) {
  const current = listStudents().find((student) => student.id === id);
  if (!current) return null;
  db.prepare(`UPDATE students SET student_number = ?, full_name = ?, email = ?, identity_status = ? WHERE id = ?`).run(
    payload.studentNumber ?? current.studentNumber, payload.fullName ?? current.fullName,
    payload.email ?? current.email, payload.identityStatus ?? current.identityStatus, id
  );
  return listStudents().find((student) => student.id === id);
}

function importStudents(students = []) {
  const imported = [];

  students.forEach(({ studentNumber, fullName, email = "" }) => {
    const normalizedNumber = String(studentNumber || "").trim();
    const normalizedName = String(fullName || "").trim();
    const normalizedEmail = String(email || "").trim();

    if (!normalizedNumber || !normalizedName) {
      return;
    }

    const id = `student-${Math.random().toString(16).slice(2, 10)}`;
    const createdAt = now();

    db.prepare(`
      INSERT INTO students (id, student_number, full_name, email, identity_status, created_at)
      VALUES (?, ?, ?, ?, 'Pending', ?)
      ON CONFLICT(student_number)
      DO UPDATE SET
        full_name = excluded.full_name,
        email = excluded.email
    `).run(id, normalizedNumber, normalizedName, normalizedEmail, createdAt);

    const student = findStudentByNumber(normalizedNumber);
    if (student) {
      imported.push(student);
    }
  });

  return imported;
}

function listRegistrations() {
  return db.prepare(`
    SELECT r.id, r.session_id AS sessionId, r.student_id AS studentId, r.verification_code AS verificationCode,
           r.seat_label AS seatLabel, r.identity_verified AS identityVerified, r.approval_status AS approvalStatus,
           r.approved_at AS approvedAt, r.last_login_at AS lastLoginAt,
           s.student_number AS studentNumber, s.full_name AS fullName,
           es.session_name AS sessionName, es.access_code AS accessCode
    FROM registrations r
    JOIN students s ON s.id = r.student_id
    JOIN exam_sessions es ON es.id = r.session_id
    ORDER BY r.created_at DESC
  `).all().map((row) => ({
    ...row,
    identityVerified: Boolean(row.identityVerified)
  }));
}

function createRegistration({ id, sessionId, studentId, verificationCode, seatLabel = "" }) {
  const createdAt = now();
  db.prepare(`
    INSERT INTO registrations (id, session_id, student_id, verification_code, seat_label, identity_verified, approval_status, approved_at, last_login_at, created_at)
    VALUES (?, ?, ?, ?, ?, 0, 'Pending', NULL, NULL, ?)
  `).run(id, sessionId, studentId, verificationCode, seatLabel, createdAt);

  return listRegistrations().find((row) => row.id === id);
}

function findStudentByNumber(studentNumber) {
  return db.prepare(`
    SELECT id, student_number AS studentNumber, full_name AS fullName, email, identity_status AS identityStatus,
           created_at AS createdAt
    FROM students
    WHERE student_number = ?
  `).get(studentNumber);
}

function getCurrentLobbySession() {
  expireStaleSessions();
  return db.prepare(`
    SELECT es.id, es.exam_id AS examId, es.session_name AS sessionName, es.access_code AS accessCode,
           es.student_count AS studentCount, es.status, es.starts_at AS startsAt, es.ends_at AS endsAt,
           es.created_at AS createdAt, e.duration_minutes AS durationMinutes, e.title AS examTitle,
           e.test_type AS testType, e.language
    FROM exam_sessions es
    JOIN exams e ON e.id = es.exam_id
    WHERE es.status IN ('Scheduled', 'Active')
    ORDER BY CASE WHEN es.status = 'Active' THEN 0 ELSE 1 END, es.created_at DESC
    LIMIT 1
  `).get();
}

function findRegistration(sessionId, studentId) {
  return db.prepare(`
    SELECT r.id, r.session_id AS sessionId, r.student_id AS studentId, r.verification_code AS verificationCode,
           r.seat_label AS seatLabel, r.identity_verified AS identityVerified, r.approval_status AS approvalStatus,
           r.approved_at AS approvedAt, r.last_login_at AS lastLoginAt,
           s.student_number AS studentNumber, s.full_name AS fullName,
           es.session_name AS sessionName, es.access_code AS accessCode
    FROM registrations r
    JOIN students s ON s.id = r.student_id
    JOIN exam_sessions es ON es.id = r.session_id
    WHERE r.session_id = ? AND r.student_id = ?
  `).get(sessionId, studentId);
}

function markStudentCheckedIn(studentId) {
  db.prepare(`
    UPDATE students
    SET identity_status = 'Checked In'
    WHERE id = ?
  `).run(studentId);

  return db.prepare(`
    SELECT id, student_number AS studentNumber, full_name AS fullName, email, identity_status AS identityStatus,
           created_at AS createdAt
    FROM students WHERE id = ?
  `).get(studentId);
}

function markRegistrationCheckedIn(registrationId) {
  const checkedInAt = now();
  db.prepare(`
    UPDATE registrations
    SET identity_verified = 1, approval_status = 'Approved', approved_at = ?, last_login_at = ?
    WHERE id = ?
  `).run(checkedInAt, checkedInAt, registrationId);

  return checkedInAt;
}

function approveRegistration(registrationId) {
  const approvedAt = now();
  const registration = db.prepare(`
    SELECT student_id AS studentId
    FROM registrations
    WHERE id = ?
  `).get(registrationId);

  if (!registration) {
    return null;
  }

  db.prepare(`
    UPDATE registrations
    SET approval_status = 'Approved', approved_at = ?
    WHERE id = ?
  `).run(approvedAt, registrationId);

  db.prepare(`
    UPDATE students
    SET identity_status = 'Approved'
    WHERE id = ?
  `).run(registration.studentId);

  return listRegistrations().find((row) => row.id === registrationId) || null;
}

function revokeRegistrationApproval(registrationId) {
  const registration = db.prepare(`
    SELECT student_id AS studentId
    FROM registrations
    WHERE id = ?
  `).get(registrationId);

  if (!registration) {
    return null;
  }

  db.prepare(`
    UPDATE registrations
    SET approval_status = 'Pending', approved_at = NULL
    WHERE id = ?
  `).run(registrationId);

  db.prepare(`
    UPDATE students
    SET identity_status = 'Waiting Approval'
    WHERE id = ?
  `).run(registration.studentId);

  return listRegistrations().find((row) => row.id === registrationId) || null;
}

function rejectRegistration(registrationId) {
  const registration = db.prepare(`
    SELECT session_id AS sessionId, student_id AS studentId
    FROM registrations
    WHERE id = ?
  `).get(registrationId);

  if (!registration) {
    return null;
  }

  db.prepare(`DELETE FROM registrations WHERE id = ?`).run(registrationId);
  db.prepare(`DELETE FROM workspaces WHERE session_id = ? AND student_id = ?`).run(registration.sessionId, registration.studentId);
  db.prepare(`DELETE FROM question_answers WHERE session_id = ? AND student_id = ?`).run(registration.sessionId, registration.studentId);
  db.prepare(`DELETE FROM submissions WHERE session_id = ? AND student_id = ?`).run(registration.sessionId, registration.studentId);
  db.prepare(`DELETE FROM activity_events WHERE session_id = ? AND student_id = ?`).run(registration.sessionId, registration.studentId);
  return registration;
}

function deleteStudent(studentId) {
  const student = db.prepare(`
    SELECT id, student_number AS studentNumber, full_name AS fullName
    FROM students
    WHERE id = ?
  `).get(studentId);

  if (!student) {
    return null;
  }

  db.prepare(`DELETE FROM registrations WHERE student_id = ?`).run(studentId);
  db.prepare(`DELETE FROM workspaces WHERE student_id = ?`).run(studentId);
  db.prepare(`DELETE FROM question_answers WHERE student_id = ?`).run(studentId);
  db.prepare(`DELETE FROM submissions WHERE student_id = ?`).run(studentId);
  db.prepare(`DELETE FROM activity_events WHERE student_id = ?`).run(studentId);
  db.prepare(`DELETE FROM students WHERE id = ?`).run(studentId);
  return student;
}

function deleteSession(sessionId) {
  const session = db.prepare(`
    SELECT id, exam_id AS examId, session_name AS sessionName
    FROM exam_sessions
    WHERE id = ?
  `).get(sessionId);

  if (!session) {
    return null;
  }

  db.prepare(`DELETE FROM registrations WHERE session_id = ?`).run(sessionId);
  db.prepare(`DELETE FROM workspaces WHERE session_id = ?`).run(sessionId);
  db.prepare(`DELETE FROM question_answers WHERE session_id = ?`).run(sessionId);
  db.prepare(`DELETE FROM submissions WHERE session_id = ?`).run(sessionId);
  db.prepare(`DELETE FROM activity_events WHERE session_id = ?`).run(sessionId);
  db.prepare(`DELETE FROM exam_sessions WHERE id = ?`).run(sessionId);
  return session;
}

function deleteExam(examId) {
  const exam = db.prepare(`
    SELECT id, title
    FROM exams
    WHERE id = ?
  `).get(examId);

  if (!exam) {
    return null;
  }

  const sessions = db.prepare(`SELECT id FROM exam_sessions WHERE exam_id = ?`).all(examId);
  sessions.forEach((session) => {
    deleteSession(session.id);
  });

  db.prepare(`DELETE FROM submissions WHERE exam_id = ?`).run(examId);
  db.prepare(`DELETE FROM workspaces WHERE exam_id = ?`).run(examId);
  db.prepare(`DELETE FROM question_answers WHERE exam_id = ?`).run(examId);
  db.prepare(`DELETE FROM activity_events WHERE exam_id = ?`).run(examId);
  db.prepare(`DELETE FROM exams WHERE id = ?`).run(examId);
  return exam;
}

function authenticateStudent({ accessCode, studentNumber, verificationCode }) {
  const row = db.prepare(`
    SELECT r.id AS registrationId,
           r.session_id AS sessionId,
           r.student_id AS studentId,
           s.full_name AS studentName,
           s.student_number AS studentNumber,
           s.email,
           e.id AS examId,
           e.title AS examTitle,
           e.language,
           es.session_name AS sessionName,
           es.status AS sessionStatus
    FROM registrations r
    JOIN students s ON s.id = r.student_id
    JOIN exam_sessions es ON es.id = r.session_id
    JOIN exams e ON e.id = es.exam_id
    WHERE es.access_code = ?
      AND s.student_number = ?
      AND r.verification_code = ?
  `).get(accessCode, studentNumber, verificationCode);

  if (!row) {
    return null;
  }

  db.prepare(`
    UPDATE registrations
    SET identity_verified = 1, last_login_at = ?
    WHERE id = ?
  `).run(now(), row.registrationId);

  db.prepare(`
    UPDATE students SET identity_status = 'Verified'
    WHERE id = ?
  `).run(row.studentId);

  return row;
}

function insertWorkspaceRecording({
  sessionId,
  studentId,
  examId,
  files,
  recordType = "AUTOSAVE",
  language = null,
  stdin = "",
  result = null,
  metadata = {},
  deduplicate = false
}) {
  const filesJson = JSON.stringify(files || {});
  const contentHash = crypto.createHash("sha256").update(filesJson).digest("hex");

  if (deduplicate) {
    const latest = db.prepare(`
      SELECT id, version_number AS versionNumber, content_hash AS contentHash,
             record_type AS recordType, created_at AS createdAt
      FROM workspace_recordings
      WHERE session_id = ? AND student_id = ?
      ORDER BY version_number DESC
      LIMIT 1
    `).get(sessionId, studentId);

    if (latest?.contentHash === contentHash && latest?.recordType === recordType) {
      return { ...latest, deduplicated: true };
    }
  }

  const versionRow = db.prepare(`
    SELECT COALESCE(MAX(version_number), 0) + 1 AS nextVersion
    FROM workspace_recordings
    WHERE session_id = ? AND student_id = ?
  `).get(sessionId, studentId);
  const versionNumber = Number(versionRow?.nextVersion || 1);
  const createdAt = now();
  const inserted = db.prepare(`
    INSERT INTO workspace_recordings (
      session_id, student_id, exam_id, version_number, record_type, language,
      files_json, stdin_text, result_json, metadata_json, content_hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    studentId,
    examId,
    versionNumber,
    recordType,
    language,
    filesJson,
    String(stdin || ""),
    result ? JSON.stringify(result) : null,
    JSON.stringify(metadata || {}),
    contentHash,
    createdAt
  );

  return {
    id: Number(inserted.lastInsertRowid),
    versionNumber,
    recordType,
    contentHash,
    createdAt,
    deduplicated: false
  };
}

function backfillWorkspaceRecordings() {
  const existingWorkspaces = db.prepare(`
    SELECT w.session_id AS sessionId, w.student_id AS studentId, w.exam_id AS examId,
           w.files_json AS filesJson, w.updated_at AS updatedAt, e.language AS language
    FROM workspaces w
    LEFT JOIN exams e ON e.id = w.exam_id
    WHERE NOT EXISTS (
      SELECT 1 FROM workspace_recordings wr
      WHERE wr.session_id = w.session_id AND wr.student_id = w.student_id
    )
  `).all();

  const insert = db.prepare(`
    INSERT INTO workspace_recordings (
      session_id, student_id, exam_id, version_number, record_type, language,
      files_json, stdin_text, result_json, metadata_json, content_hash, created_at
    ) VALUES (?, ?, ?, 1, 'LEGACY_SNAPSHOT', ?, ?, '', NULL, '{}', ?, ?)
  `);

  existingWorkspaces.forEach((workspace) => {
    const contentHash = crypto.createHash("sha256").update(workspace.filesJson).digest("hex");
    insert.run(
      workspace.sessionId,
      workspace.studentId,
      workspace.examId,
      workspace.language || null,
      workspace.filesJson,
      contentHash,
      workspace.updatedAt || now()
    );
  });
}

function recordWorkspaceVersion(payload) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const recording = insertWorkspaceRecording(payload);
    db.exec("COMMIT");
    return recording;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function listWorkspaceRecordings(sessionId, studentId, { limit = 100, beforeVersion = null } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 250));
  return db.prepare(`
    SELECT id, session_id AS sessionId, student_id AS studentId, exam_id AS examId,
           version_number AS versionNumber, record_type AS recordType, language,
           files_json AS filesJson, stdin_text AS stdinText, result_json AS resultJson,
           metadata_json AS metadataJson, content_hash AS contentHash, created_at AS createdAt
    FROM workspace_recordings
    WHERE session_id = ? AND student_id = ?
      AND (? IS NULL OR version_number < ?)
    ORDER BY version_number DESC
    LIMIT ?
  `).all(sessionId, studentId, beforeVersion, beforeVersion, safeLimit).map((row) => ({
    ...row,
    files: safeJsonParse(row.filesJson, {}),
    result: safeJsonParse(row.resultJson, null),
    metadata: safeJsonParse(row.metadataJson, {}),
    filesJson: undefined,
    resultJson: undefined,
    metadataJson: undefined
  }));
}

function countWorkspaceRecordings(sessionId, studentId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS total
    FROM workspace_recordings
    WHERE session_id = ? AND student_id = ?
  `).get(sessionId, studentId);
  return Number(row?.total || 0);
}

function saveQuestionAnswer({ sessionId, studentId, examId, questionId, files, stdin = "", result, answerText = "", selectedOption = "", scratchFiles, scratchStdin = "", scratchResult }) {
  if (!questionId) {
    return null;
  }
  const updatedAt = now();
  db.prepare(`
    INSERT INTO question_answers (
      session_id, student_id, exam_id, question_id, files_json, stdin_text, result_json, answer_text, selected_option,
      scratch_files_json, scratch_stdin_text, scratch_result_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, student_id, question_id)
    DO UPDATE SET
      exam_id = excluded.exam_id,
      files_json = excluded.files_json,
      stdin_text = excluded.stdin_text,
      result_json = excluded.result_json,
      answer_text = excluded.answer_text,
      selected_option = excluded.selected_option,
      scratch_files_json = excluded.scratch_files_json,
      scratch_stdin_text = excluded.scratch_stdin_text,
      scratch_result_json = excluded.scratch_result_json,
      updated_at = excluded.updated_at
  `).run(
    sessionId,
    studentId,
    examId,
    questionId,
    JSON.stringify(files || {}),
    String(stdin || ""),
    result === undefined ? null : JSON.stringify(result),
    String(answerText || ""),
    String(selectedOption || ""),
    JSON.stringify(scratchFiles || {}),
    String(scratchStdin || ""),
    scratchResult === undefined ? null : JSON.stringify(scratchResult),
    updatedAt
  );
  return getQuestionAnswer(sessionId, studentId, questionId);
}

function getQuestionAnswer(sessionId, studentId, questionId) {
  const row = db.prepare(`
    SELECT session_id AS sessionId, student_id AS studentId, exam_id AS examId,
           question_id AS questionId, files_json AS filesJson, stdin_text AS stdinText,
           result_json AS resultJson, answer_text AS answerText, selected_option AS selectedOption,
           scratch_files_json AS scratchFilesJson, scratch_stdin_text AS scratchStdinText,
           scratch_result_json AS scratchResultJson,
           score, feedback, grading_status AS gradingStatus,
           updated_at AS updatedAt, graded_at AS gradedAt
    FROM question_answers
    WHERE session_id = ? AND student_id = ? AND question_id = ?
  `).get(sessionId, studentId, questionId);
  return row ? {
    ...row,
    files: safeJsonParse(row.filesJson, {}),
    result: safeJsonParse(row.resultJson, null),
    scratchFiles: safeJsonParse(row.scratchFilesJson, {}),
    scratchResult: safeJsonParse(row.scratchResultJson, null),
    filesJson: undefined,
    resultJson: undefined,
    scratchFilesJson: undefined,
    scratchResultJson: undefined
  } : null;
}

function listQuestionAnswers(sessionId, studentId) {
  return db.prepare(`
    SELECT question_id AS questionId
    FROM question_answers
    WHERE session_id = ? AND student_id = ?
  `).all(sessionId, studentId).map((row) => getQuestionAnswer(sessionId, studentId, row.questionId));
}

function gradeQuestionAnswer(sessionId, studentId, questionId, { score = null, feedback = "", gradingStatus = "Graded", examId = "" }) {
  const gradedAt = now();
  db.prepare(`
    INSERT INTO question_answers (
      session_id, student_id, exam_id, question_id, files_json, stdin_text, result_json, answer_text, selected_option,
      scratch_files_json, scratch_stdin_text, scratch_result_json, score, feedback, grading_status, updated_at, graded_at
    ) VALUES (?, ?, ?, ?, '{}', '', NULL, '', '', '{}', '', NULL, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, student_id, question_id)
    DO UPDATE SET score = excluded.score, feedback = excluded.feedback,
      grading_status = excluded.grading_status, graded_at = excluded.graded_at
  `).run(
    sessionId,
    studentId,
    examId,
    questionId,
    score === null || score === "" ? null : Number(score),
    String(feedback || ""),
    gradingStatus,
    gradedAt,
    gradedAt
  );
  return getQuestionAnswer(sessionId, studentId, questionId);
}

function getWorkspace(sessionId, studentId, examId, defaultFiles, language = null) {
  const existing = db.prepare(`
    SELECT exam_id AS examId, files_json AS filesJson, last_run_json AS lastRunJson, updated_at AS updatedAt
    FROM workspaces
    WHERE session_id = ? AND student_id = ?
  `).get(sessionId, studentId);

  if (!existing) {
    const createdAt = now();
    db.prepare(`
      INSERT INTO workspaces (session_id, student_id, exam_id, files_json, last_run_json, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?)
    `).run(sessionId, studentId, examId, JSON.stringify(defaultFiles), createdAt);

    return {
      files: { ...defaultFiles },
      lastRun: null,
      updatedAt: createdAt
    };
  }

  // If a new exam is loaded for the same session/student key, reset files to that exam's defaults.
  if (existing.examId !== examId) {
    const updatedAt = now();
    db.prepare(`
      UPDATE workspaces
      SET exam_id = ?, files_json = ?, last_run_json = NULL, updated_at = ?
      WHERE session_id = ? AND student_id = ?
    `).run(examId, JSON.stringify(defaultFiles), updatedAt, sessionId, studentId);

    return {
      files: { ...defaultFiles },
      lastRun: null,
      updatedAt
    };
  }

  return {
    files: JSON.parse(existing.filesJson),
    lastRun: existing.lastRunJson ? JSON.parse(existing.lastRunJson) : null,
    updatedAt: existing.updatedAt
  };
}

function saveWorkspace(sessionId, studentId, examId, files, options = {}) {
  const updatedAt = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO workspaces (session_id, student_id, exam_id, files_json, last_run_json, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?)
      ON CONFLICT(session_id, student_id)
      DO UPDATE SET exam_id = excluded.exam_id, files_json = excluded.files_json, updated_at = excluded.updated_at
    `).run(sessionId, studentId, examId, JSON.stringify(files), updatedAt);

    const recording = null;
    db.exec("COMMIT");

    return {
      files,
      updatedAt,
      syncedAt: updatedAt,
      recording
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function setLastRun(sessionId, studentId, result) {
  const updatedAt = now();
  db.prepare(`
    UPDATE workspaces
    SET last_run_json = ?, updated_at = ?
    WHERE session_id = ? AND student_id = ?
  `).run(JSON.stringify({ ...result, at: updatedAt }), updatedAt, sessionId, studentId);
}

function recordActivity({ sessionId, studentId, examId, eventType, payload }) {
  db.prepare(`
    INSERT INTO activity_events (session_id, student_id, exam_id, event_type, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sessionId || null, studentId || null, examId || null, eventType, JSON.stringify(payload || {}), now());
}

function recordSubmission({ id, sessionId, studentId, examId, files, language = null, status = "Submitted" }) {
  const submittedAt = now();
  db.prepare(`
    INSERT INTO submissions (id, session_id, student_id, exam_id, files_json, submitted_at, status, grade_score, grade_status, teacher_feedback, reviewed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'Pending Review', '', NULL)
  `).run(id, sessionId, studentId, examId, JSON.stringify(files), submittedAt, status);

  return db.prepare(`
    SELECT id, session_id AS sessionId, student_id AS studentId, exam_id AS examId,
           submitted_at AS submittedAt, status, grade_score AS gradeScore,
           grade_status AS gradeStatus, teacher_feedback AS teacherFeedback, reviewed_at AS reviewedAt
    FROM submissions WHERE id = ?
  `).get(id);
}

function finalizeSessionSubmissions(sessionId) {
  const rows = db.prepare(`
    SELECT w.session_id AS sessionId, w.student_id AS studentId, w.exam_id AS examId,
           w.files_json AS filesJson, e.language AS language
    FROM workspaces w
    LEFT JOIN exams e ON e.id = w.exam_id
    WHERE w.session_id = ?
  `).all(sessionId);

  const created = [];

  rows.forEach((row) => {
    const existing = db.prepare(`
      SELECT id FROM submissions WHERE session_id = ? AND student_id = ?
    `).get(row.sessionId, row.studentId);

    if (existing) {
      return;
    }

    created.push(
      recordSubmission({
        id: `submission-${Math.random().toString(16).slice(2, 10)}`,
        sessionId: row.sessionId,
        studentId: row.studentId,
        examId: row.examId,
        files: JSON.parse(row.filesJson),
        language: row.language,
        status: "Submitted"
      })
    );
  });

  return created;
}

function listSubmissions() {
  return db.prepare(`
    SELECT sub.id, sub.session_id AS sessionId, sub.student_id AS studentId, sub.exam_id AS examId,
           sub.submitted_at AS submittedAt, sub.status, sub.grade_score AS gradeScore,
           sub.grade_status AS gradeStatus, sub.teacher_feedback AS teacherFeedback, sub.reviewed_at AS reviewedAt,
           COALESCE(s.student_number, sub.student_id) AS studentNumber,
           COALESCE(s.full_name, sub.student_id) AS fullName,
           COALESCE(es.session_name, sub.session_id) AS sessionName,
           COALESCE(e.title, sub.exam_id) AS examTitle
    FROM submissions sub
    LEFT JOIN students s ON s.id = sub.student_id
    LEFT JOIN exam_sessions es ON es.id = sub.session_id
    LEFT JOIN exams e ON e.id = sub.exam_id
    ORDER BY sub.submitted_at DESC
  `).all();
}

function getSubmissionById(id) {
  const row = db.prepare(`
    SELECT sub.id, sub.session_id AS sessionId, sub.student_id AS studentId, sub.exam_id AS examId,
           sub.files_json AS filesJson, sub.submitted_at AS submittedAt, sub.status,
           sub.grade_score AS gradeScore, sub.grade_status AS gradeStatus,
           sub.teacher_feedback AS teacherFeedback, sub.reviewed_at AS reviewedAt,
           COALESCE(s.student_number, sub.student_id) AS studentNumber,
           COALESCE(s.full_name, sub.student_id) AS fullName,
           COALESCE(es.session_name, sub.session_id) AS sessionName,
           COALESCE(e.title, sub.exam_id) AS examTitle,
           COALESCE(e.language, 'Python') AS language,
           COALESCE(e.test_type, 'Coding') AS testType
    FROM submissions sub
    LEFT JOIN students s ON s.id = sub.student_id
    LEFT JOIN exam_sessions es ON es.id = sub.session_id
    LEFT JOIN exams e ON e.id = sub.exam_id
    WHERE sub.id = ?
  `).get(id);

  if (!row) {
    return null;
  }

  const exam = getExamById(row.examId);
  const answerMap = new Map(listQuestionAnswers(row.sessionId, row.studentId).map((answer) => [answer.questionId, answer]));
  const questionAnswers = (exam?.questions || []).map((question, index) => {
    const answer = answerMap.get(question.id);
    const coding = /coding|debug|frontend/i.test(String(question.format || ""));
    const answered = coding
      ? Boolean(answer && Object.values(answer.files || {}).some((content) => String(content).trim()))
      : Boolean(answer && (String(answer.answerText || "").trim() || String(answer.selectedOption || "") !== ""));
    return {
      questionId: question.id,
      questionNumber: index + 1,
      title: question.title,
      prompt: question.prompt,
      points: question.points,
      format: question.format,
      options: question.options || [],
      answerGuide: question.answerGuide,
      answered,
      ...(answer || { files: {}, stdinText: "", result: null, scratchFiles: {}, scratchStdinText: "", scratchResult: null, score: null, feedback: "", gradingStatus: "Pending" })
    };
  });

  return {
    ...row,
    files: JSON.parse(row.filesJson),
    questionAnswers,
    maximumScore: questionAnswers.reduce((total, answer) => total + Number(answer.points || 0), 0)
  };
}

function gradeSubmission(id, { gradeScore = null, gradeStatus = "Reviewed", teacherFeedback = "" }) {
  const reviewedAt = now();
  db.prepare(`
    UPDATE submissions
    SET grade_score = ?, grade_status = ?, teacher_feedback = ?, reviewed_at = ?
    WHERE id = ?
  `).run(
    gradeScore === null || gradeScore === "" ? null : Number(gradeScore),
    gradeStatus,
    teacherFeedback,
    reviewedAt,
    id
  );

  return getSubmissionById(id);
}

function buildAnswerBook({ sessionId = null, examId = null }) {
  const sessions = sessionId
    ? [getSessionById(sessionId)].filter(Boolean)
    : listSessions().filter((session) => session.examId === examId);

  return sessions.map((session) => {
    const exam = getExamById(session.examId);
    const registrations = listRegistrations().filter((registration) => registration.sessionId === session.id);
    const submissions = listSubmissions().filter((submission) => submission.sessionId === session.id);
    const identities = new Map();
    registrations.forEach((registration) => identities.set(registration.studentId, registration));
    submissions.forEach((submission) => {
      if (!identities.has(submission.studentId)) identities.set(submission.studentId, submission);
    });
    return {
      session,
      exam,
      students: [...identities.values()].map((registration) => {
        const submissionSummary = submissions.find((submission) => submission.studentId === registration.studentId);
        const submission = submissionSummary ? getSubmissionById(submissionSummary.id) : null;
        const answerMap = new Map(listQuestionAnswers(session.id, registration.studentId).map((answer) => [answer.questionId, answer]));
        const questions = (exam?.questions || []).map((question, index) => ({
          number: index + 1,
          ...question,
          answer: answerMap.get(question.id) || null
        }));
        return {
          studentId: registration.studentId,
          studentNumber: registration.studentNumber,
          fullName: registration.fullName,
          submittedAt: submission?.submittedAt || null,
          finalScore: submission?.gradeScore ?? null,
          gradeStatus: submission?.gradeStatus || "Not submitted",
          teacherFeedback: submission?.teacherFeedback || "",
          questions
        };
      })
    };
  });
}

function buildSubmissionAnswerBook(submissionId) {
  const submission = getSubmissionById(submissionId);
  if (!submission) return [];
  const session = getSessionById(submission.sessionId);
  const exam = getExamById(submission.examId);
  const answerMap = new Map(submission.questionAnswers.map((answer) => [answer.questionId, answer]));
  return [{
    session,
    exam,
    students: [{
      studentId: submission.studentId,
      studentNumber: submission.studentNumber,
      fullName: submission.fullName,
      submittedAt: submission.submittedAt,
      finalScore: submission.gradeScore,
      gradeStatus: submission.gradeStatus,
      teacherFeedback: submission.teacherFeedback,
      questions: (exam?.questions || []).map((question, index) => ({ number: index + 1, ...question, answer: answerMap.get(question.id) || null }))
    }]
  }];
}

function deleteSubmission(id) {
  const submission = getSubmissionById(id);
  if (!submission) return null;
  db.prepare(`DELETE FROM submissions WHERE id = ?`).run(id);
  db.prepare(`DELETE FROM question_answers WHERE session_id = ? AND student_id = ?`).run(submission.sessionId, submission.studentId);
  db.prepare(`DELETE FROM workspaces WHERE session_id = ? AND student_id = ?`).run(submission.sessionId, submission.studentId);
  return submission;
}

module.exports = {
  dbPath,
  listExams,
  getExamById,
  createExam,
  updateExam,
  listSessions,
  getSessionById,
  createSession,
  updateSession,
  updateSessionStatus,
  listStudents,
  createStudent,
  updateStudent,
  importStudents,
  listRegistrations,
  createRegistration,
  findStudentByNumber,
  getCurrentLobbySession,
  findRegistration,
  markStudentCheckedIn,
  markRegistrationCheckedIn,
  approveRegistration,
  revokeRegistrationApproval,
  rejectRegistration,
  deleteStudent,
  deleteSession,
  deleteExam,
  authenticateStudent,
  finalizeSessionSubmissions,
  getActiveSession,
  getOpenTimer,
  getWorkspace,
  saveWorkspace,
  recordWorkspaceVersion,
  listWorkspaceRecordings,
  countWorkspaceRecordings,
  saveQuestionAnswer,
  getQuestionAnswer,
  listQuestionAnswers,
  gradeQuestionAnswer,
  setLastRun,
  recordActivity,
  recordSubmission,
  listSubmissions,
  getSubmissionById,
  gradeSubmission,
  deleteSubmission,
  buildAnswerBook,
  buildSubmissionAnswerBook
};
