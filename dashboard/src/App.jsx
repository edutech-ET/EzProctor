import React, { useCallback, useEffect, useMemo, useState } from "react";

const backendUrl =
  import.meta.env.VITE_BACKEND_URL ||
  (window.location.port === "5173" ? "http://127.0.0.1:8787" : window.location.origin);

const navItems = [
  ["overview", "Overview", "01"],
  ["exams", "Exams & Import", "02"],
  ["sessions", "Sessions & Release", "03"],
  ["learners", "Learners", "04"],
  ["monitor", "Monitor & Grade", "05"]
];

const questionFormats = ["Coding", "Frontend", "Debugging", "Multiple Choice", "Short Question", "Long Question"];

function extractLabeledItems(value = "") {
  const text = String(value).replace(/\r/g, " ");
  const markerPattern = /(?:^|\s)(?:\(([A-Ha-h])\)\.?|([A-Ha-h])\s*(?:\.\)|\)|\.|:|\-))\s+/g;
  const markers = [];
  let match;
  while ((match = markerPattern.exec(text))) {
    markers.push({ label: (match[1] || match[2]).toUpperCase(), start: match.index, contentStart: markerPattern.lastIndex });
  }
  const sequential = markers.filter((marker, index) => index === 0 || marker.label.charCodeAt(0) === markers[index - 1].label.charCodeAt(0) + 1);
  if (sequential.length < 2 || sequential[0].label !== "A" || sequential[1].label !== "B") return [];
  return sequential.map((marker, index) => {
    const next = sequential[index + 1];
    return text.slice(marker.contentStart, next ? next.start : text.length).replace(/\s+/g, " ").trim();
  }).filter(Boolean);
}

function extractLabeledOptions(value = "", context = "", requestedFormat = "") {
  const items = extractLabeledItems(value);
  if (items.length < 2) return [];
  const surrounding = `${requestedFormat} ${context} ${value}`.toLowerCase();
  if (/\b(multiple choice|mcq|choose (?:one|the correct|the best)|select one|which (?:of|is|statement))\b/.test(surrounding)) return items;
  if (/\b(short questions?|short answers?|long questions?|long answers?|essay|written response|theory)\b/.test(`${requestedFormat} ${context}`.toLowerCase())) return [];
  if (items.some((item) => /\b\d+(?:\.\d+)?\s*marks?\b/i.test(item))) return [];
  const instructionPattern = /^(?:explain|describe|discuss|evaluate|compare|contrast|justify|define|outline|summarize|analyse|analyze|write|create|implement|calculate|show|prove|identify|state|what|why|how)\b/i;
  const instructionCount = items.filter((item) => instructionPattern.test(item) || /\?$/.test(item.trim())).length;
  return instructionCount >= Math.min(2, items.length) ? [] : items;
}

function inferQuestionFormat(question = {}) {
  const context = `${question.section || ""} ${question.title || ""}`;
  const labeledOptions = extractLabeledOptions(question.prompt || question.question || "", context, question.format || question.questionType || question.type || "");
  const options = Array.isArray(question.options) ? question.options : String(question.options || "").split("|").filter(Boolean);
  if (labeledOptions.length >= 2 || options.length >= 2) return "Multiple Choice";
  const requested = String(question.format || question.questionType || question.type || "").trim().toLowerCase();
  const aliases = {
    code: "Coding", coding: "Coding", programming: "Coding", practical: "Coding",
    html: "Frontend", css: "Frontend", web: "Frontend", frontend: "Frontend",
    debug: "Debugging", debugging: "Debugging", correction: "Debugging",
    mcq: "Multiple Choice", multiplechoice: "Multiple Choice", "multiple choice": "Multiple Choice", choice: "Multiple Choice",
    short: "Short Question", "short answer": "Short Question", "short question": "Short Question",
    long: "Long Question", essay: "Long Question", "long answer": "Long Question", "long question": "Long Question"
  };
  if (aliases[requested]) return aliases[requested];
  const content = `${question.title || ""} ${question.prompt || question.question || ""} ${question.starter || ""}`.toLowerCase();
  if (/\b(debug|fix|correct|error|bug|syntax)\b/.test(content)) return "Debugging";
  if (/\b(html|css|webpage|web page|frontend|layout)\b/.test(content)) return "Frontend";
  if (/\b(write|create|implement|build|program|code|function|class|struct|algorithm)\b/.test(content) || question.starter) return "Coding";
  if (/\b(discuss|evaluate|justify|essay|critically|in detail)\b/.test(content)) return "Long Question";
  return "Short Question";
}

async function jsonFetch(path, options = {}) {
  const response = await fetch(`${backendUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  values.push(current.trim());
  return values;
}

function parseCsvRows(text) {
  const rows = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      current += character;
      if (quoted && text[index + 1] === '"') {
        current += text[index + 1];
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (current.trim()) rows.push(parseCsvLine(current));
      current = "";
      if (character === "\r" && text[index + 1] === "\n") index += 1;
    } else {
      current += character;
    }
  }
  if (current.trim()) rows.push(parseCsvLine(current));
  return rows;
}

function normalizeQuestion(question, index) {
  const fields = Object.fromEntries(Object.entries(question || {}).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]/g, ""), value]));
  const prepared = {
    ...question,
    format: question.format || fields.questiontype || fields.type || fields.format,
    title: question.title || fields.title,
    prompt: question.prompt || fields.prompt || fields.question || fields.instructions,
    points: question.points || fields.points || fields.marks,
    options: question.options || fields.options || fields.choices || fields.answers,
    starter: question.starter || fields.starter || fields.startercode,
    answerGuide: question.answerGuide || fields.answerguide || fields.markingguide || fields.modelanswer || fields.suggestedanswer || fields.correctanswer || fields.answerkey || fields.answer || fields.solution || fields.rubric
  };
  const options = Array.isArray(prepared.options)
    ? prepared.options
    : String(prepared.options || "").split("|").map((value) => value.trim()).filter(Boolean);
  const detectedOptions = options.length >= 2
    ? options
    : extractLabeledOptions(prepared.prompt || "", `${prepared.section || ""} ${prepared.title || ""}`, prepared.format || "");
  return {
    id: prepared.id || `question-${crypto.randomUUID().slice(0, 8)}`,
    number: index + 1,
    format: inferQuestionFormat({ ...prepared, options: detectedOptions }),
    title: prepared.title || `Question ${index + 1}`,
    section: prepared.section || "",
    prompt: prepared.prompt || "",
    points: Number(prepared.points || 10),
    options: detectedOptions,
    starter: prepared.starter || "",
    answerGuide: prepared.answerGuide || ""
  };
}

function normalizeImportedQuestions(imported, existingCount = 0) {
  return (Array.isArray(imported) ? imported : []).map((question, index) => ({
    ...normalizeQuestion(question, existingCount + index),
    id: `question-${crypto.randomUUID().slice(0, 8)}`,
    number: existingCount + index + 1
  }));
}

function parseQuestionFile(fileName, text) {
  if (fileName.toLowerCase().endsWith(".json")) {
    const parsed = JSON.parse(text);
    const questions = Array.isArray(parsed) ? parsed : parsed.questions;
    if (!Array.isArray(questions)) throw new Error("JSON requires a questions array.");
    return questions.map(normalizeQuestion);
  }
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((header, index) => index === 0 ? header.replace(/^\uFEFF/, "") : header);
  return rows.slice(1).map((values, index) => {
    return normalizeQuestion(Object.fromEntries(headers.map((header, column) => [header, values[column] || ""])), index);
  }).filter((question) => question.title && question.prompt);
}

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function Status({ tone = "neutral", children }) {
  return <span className={`status status-${tone}`}>{children}</span>;
}

function Empty({ title, copy }) {
  return <div className="empty-state"><span>0</span><strong>{title}</strong><p>{copy}</p></div>;
}

function App() {
  const [activeView, setActiveView] = useState("overview");
  const [overview, setOverview] = useState({ exams: [], sessions: [], roster: [], registrations: [], students: [], submissions: [] });
  const [socketState, setSocketState] = useState("Connecting");
  const [notice, setNotice] = useState({ tone: "neutral", text: "Educator workspace ready." });
  const [busy, setBusy] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [editingExamId, setEditingExamId] = useState("");
  const [editingQuestionId, setEditingQuestionId] = useState("");
  const [examForm, setExamForm] = useState({ title: "", language: "Python", testType: "Coding", durationMinutes: 90 });
  const [questionForm, setQuestionForm] = useState({ format: "Coding", title: "", prompt: "", points: 10, starter: "", answerGuide: "", optionsText: "" });
  const [sessionForm, setSessionForm] = useState({ examId: "", sessionName: "", studentCount: 30 });
  const [studentForm, setStudentForm] = useState({ studentNumber: "", fullName: "", email: "" });
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [answerImportPreview, setAnswerImportPreview] = useState(null);
  const [gradeForm, setGradeForm] = useState({ gradeScore: "", gradeStatus: "Pending Review", teacherFeedback: "" });
  const [questionGrades, setQuestionGrades] = useState({});

  const refresh = useCallback(async () => {
    const data = await jsonFetch("/api/dashboard/overview");
    setOverview({
      exams: data.exams || [], sessions: data.sessions || [], roster: data.roster || [],
      registrations: data.registrations || [], students: data.students || [], submissions: data.submissions || []
    });
    setSessionForm((current) => ({ ...current, examId: current.examId || data.exams?.[0]?.id || "" }));
    setSelectedSessionId((current) => current || data.sessions?.[0]?.id || "");
  }, []);

  useEffect(() => {
    refresh().catch((error) => setNotice({ tone: "danger", text: error.message }));
    const socket = new WebSocket(`${backendUrl.replace("http", "ws")}/ws`);
    socket.onopen = () => setSocketState("Live");
    socket.onmessage = () => refresh().catch(() => {});
    socket.onerror = () => setSocketState("Offline");
    socket.onclose = () => setSocketState("Offline");
    return () => socket.close();
  }, [refresh]);

  const activeSessions = useMemo(() => overview.sessions.filter((session) => session.status === "Active"), [overview.sessions]);
  const selectedSession = overview.sessions.find((session) => session.id === selectedSessionId) || null;
  const assignedIds = useMemo(
    () => new Set(overview.registrations.filter((registration) => registration.sessionId === selectedSessionId).map((registration) => registration.studentId)),
    [overview.registrations, selectedSessionId]
  );
  const checkedIn = overview.registrations.filter((registration) => registration.identityVerified).length;
  const ungraded = overview.submissions.filter((submission) => !submission.reviewedAt).length;

  async function perform(label, action) {
    setBusy(true);
    setNotice({ tone: "neutral", text: label });
    try {
      const result = await action();
      await refresh();
      setNotice({ tone: "success", text: `${label.replace(/\.\.\.$/, "")} complete.` });
      return result;
    } catch (error) {
      setNotice({ tone: "danger", text: error.message });
      return null;
    } finally {
      setBusy(false);
    }
  }

  function addManualQuestion(event) {
    event.preventDefault();
    if (!questionForm.title.trim() || !questionForm.prompt.trim()) {
      setNotice({ tone: "danger", text: "Question title and prompt are required." });
      return;
    }
    const prepared = { ...questionForm, options: questionForm.optionsText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) };
    setQuestions((current) => editingQuestionId
      ? current.map((question, index) => question.id === editingQuestionId ? normalizeQuestion({ ...prepared, id: editingQuestionId }, index) : question)
      : [...current, normalizeQuestion(prepared, current.length)]);
    setEditingQuestionId("");
    setQuestionForm({ format: "Coding", title: "", prompt: "", points: 10, starter: "", answerGuide: "", optionsText: "" });
    setNotice({ tone: "success", text: "Question added to the exam draft." });
  }

  async function importQuestions(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const importedResult = await perform("Importing and classifying questions...", async () => {
      if (/\.(docx|txt|md)$/i.test(file.name)) {
        const result = await jsonFetch("/api/dashboard/questions/import-document", {
          method: "POST",
          body: JSON.stringify({ ...examForm, fileName: file.name, contentBase64: await fileToBase64(file), questionCount: 50 })
        });
        setQuestions((current) => [...current, ...normalizeImportedQuestions(result.questions, current.length)]);
        if (result.metadata?.detectedLanguage) setExamForm((current) => ({ ...current, language: result.metadata.detectedLanguage }));
        return result;
      }
      const imported = parseQuestionFile(file.name, await file.text());
      setQuestions((current) => [...current, ...normalizeImportedQuestions(imported, current.length)]);
      return imported;
    });
    const importedCount = Array.isArray(importedResult) ? importedResult.length : importedResult?.questions?.length || 0;
    if (importedResult) setNotice({ tone: "success", text: `${importedCount} questions imported, classified, and numbered. Review the Type selectors before saving.` });
    event.target.value = "";
  }

  async function previewModelAnswers(exam, event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const preview = await perform("Mapping model answers to exam questions...", async () => jsonFetch(`/api/dashboard/exams/${exam.id}/model-answers/preview`, {
      method: "POST",
      body: JSON.stringify({ fileName: file.name, contentBase64: await fileToBase64(file) })
    }));
    event.target.value = "";
    if (preview) setAnswerImportPreview({ ...preview, examTitle: exam.title });
  }

  async function applyModelAnswers() {
    if (!answerImportPreview) return;
    const result = await perform("Applying reviewed model answers...", () => jsonFetch(`/api/dashboard/exams/${answerImportPreview.examId}/model-answers/apply`, {
      method: "POST",
      body: JSON.stringify({ matches: answerImportPreview.matches })
    }));
    if (result) {
      setAnswerImportPreview(null);
      setNotice({ tone: "success", text: `${result.appliedCount} model answers applied. Pre-grades remain draft suggestions until the educator saves each mark.` });
    }
  }

  function updateDraftQuestionType(questionId, format) {
    setQuestions((current) => current.map((question) => question.id === questionId ? {
      ...question,
      format,
      options: format === "Multiple Choice" ? question.options : [],
      starter: ["Coding", "Frontend", "Debugging"].includes(format) ? question.starter : ""
    } : question));
  }

  async function createExam(event) {
    event.preventDefault();
    const editing = Boolean(editingExamId);
    const orderedQuestions = questions.map((question, index) => ({ ...question, number: index + 1 }));
    const exam = await perform(editing ? "Updating exam..." : "Creating exam...", () => jsonFetch(editing ? `/api/dashboard/exams/${editingExamId}` : "/api/dashboard/exams", {
      method: editing ? "PUT" : "POST", body: JSON.stringify({ ...examForm, questions: orderedQuestions })
    }));
    if (exam) {
      setQuestions([]);
      setEditingExamId("");
      setExamForm((current) => ({ ...current, title: "" }));
      if (!editing) {
        setSessionForm((current) => ({ ...current, examId: exam.id }));
        setActiveView("sessions");
      }
    }
  }

  async function createSession(event) {
    event.preventDefault();
    const exam = overview.exams.find((item) => item.id === sessionForm.examId);
    const result = await perform("Creating session...", () => jsonFetch("/api/dashboard/sessions", {
      method: "POST",
      body: JSON.stringify({ ...sessionForm, sessionName: sessionForm.sessionName.trim() || `${exam?.title || "Exam"} - ${new Date().toLocaleDateString()}` })
    }));
    if (result) setSelectedSessionId(result.id);
  }

  async function releaseSession(sessionId) {
    await perform("Releasing exam to students...", () => jsonFetch(`/api/dashboard/sessions/${sessionId}/start`, { method: "POST" }));
  }

  async function closeSession(sessionId) {
    await perform("Closing and collecting session...", () => jsonFetch(`/api/dashboard/sessions/${sessionId}/stop`, { method: "POST" }));
  }

  async function assignAll(sessionIdOverride = "") {
    const targetSessionId = typeof sessionIdOverride === "string" && sessionIdOverride ? sessionIdOverride : selectedSessionId;
    if (!targetSessionId) return setNotice({ tone: "danger", text: "Choose a session first." });
    await perform("Assigning learners...", async () => {
      const targetAssignedIds = new Set(
        overview.registrations
          .filter((registration) => registration.sessionId === targetSessionId)
          .map((registration) => registration.studentId)
      );
      for (const student of overview.roster) {
        if (!targetAssignedIds.has(student.id)) {
          await jsonFetch("/api/dashboard/registrations", { method: "POST", body: JSON.stringify({ sessionId: targetSessionId, studentId: student.id, seatLabel: "" }) });
        }
      }
    });
  }

  async function createStudent(event) {
    event.preventDefault();
    const result = await perform("Adding learner...", () => jsonFetch("/api/dashboard/students", { method: "POST", body: JSON.stringify(studentForm) }));
    if (result) setStudentForm({ studentNumber: "", fullName: "", email: "" });
  }

  async function importStudents(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const lines = (await file.text()).split(/\r?\n/).filter((line) => line.trim());
    const headers = parseCsvLine(lines[0] || "");
    const students = lines.slice(1).map((line) => {
      const values = parseCsvLine(line);
      return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
    }).filter((student) => student.studentNumber && student.fullName);
    await perform("Importing learner roster...", () => jsonFetch("/api/dashboard/students/import", { method: "POST", body: JSON.stringify({ students }) }));
    event.target.value = "";
  }

  async function openSubmission(id) {
    const submission = await perform("Loading submission...", () => jsonFetch(`/api/dashboard/submissions/${id}`));
    if (submission) {
      setSelectedSubmission(submission);
      setGradeForm({ gradeScore: submission.gradeScore ?? "", gradeStatus: submission.gradeStatus || "Pending Review", teacherFeedback: submission.teacherFeedback || "" });
      setQuestionGrades(Object.fromEntries((submission.questionAnswers || []).map((answer) => [answer.questionId, { score: answer.score ?? "", feedback: answer.feedback || "", gradingStatus: answer.gradingStatus || "Pending" }])));
    }
  }

  async function saveGrade(event) {
    event.preventDefault();
    if (!selectedSubmission) return;
    const questionGradePayload = selectedSubmission.questionAnswers.map((answer) => ({
      questionId: answer.questionId,
      score: questionGrades[answer.questionId]?.score ?? answer.score ?? "",
      feedback: questionGrades[answer.questionId]?.feedback ?? answer.feedback ?? "",
      gradingStatus: "Graded"
    }));
    const calculatedTotal = questionGradePayload.reduce((sum, grade) => sum + Number(grade.score || 0), 0);
    const saved = await perform("Saving all grades and feedback...", () => jsonFetch(`/api/dashboard/submissions/${selectedSubmission.id}/grades`, {
      method: "POST",
      body: JSON.stringify({ ...gradeForm, gradeScore: calculatedTotal, gradeStatus: gradeForm.gradeStatus === "Pending Review" ? "Graded" : gradeForm.gradeStatus, questionGrades: questionGradePayload })
    }));
    if (saved) {
      setSelectedSubmission(saved);
      setGradeForm({ gradeScore: saved.gradeScore ?? calculatedTotal, gradeStatus: saved.gradeStatus || "Graded", teacherFeedback: saved.teacherFeedback || "" });
      setQuestionGrades(Object.fromEntries((saved.questionAnswers || []).map((answer) => [answer.questionId, { score: answer.score ?? "", feedback: answer.feedback || "", gradingStatus: answer.gradingStatus || "Graded" }])));
      setNotice({ tone: "success", text: `Grades saved for ${saved.fullName}. Final score: ${saved.gradeScore}/${saved.maximumScore}.` });
    }
  }

  async function saveQuestionGrade(answer) {
    const draft = questionGrades[answer.questionId] || {};
    const saved = await perform(`Saving Question ${answer.questionNumber} grade...`, () => jsonFetch(`/api/dashboard/submissions/${selectedSubmission.id}/questions/${answer.questionId}/grade`, { method: "POST", body: JSON.stringify(draft) }));
    if (saved) {
      setSelectedSubmission((current) => {
        const questionAnswers = current.questionAnswers.map((item) => item.questionId === answer.questionId ? { ...item, ...saved } : item);
        const total = questionAnswers.reduce((sum, item) => sum + Number(item.score || 0), 0);
        setGradeForm((form) => ({ ...form, gradeScore: total }));
        return { ...current, questionAnswers };
      });
    }
  }

  async function suggestQuestionGrade(answer) {
    const suggestion = await perform(`Preparing Question ${answer.questionNumber} suggestion...`, () => jsonFetch(`/api/dashboard/submissions/${selectedSubmission.id}/questions/${answer.questionId}/suggest-grade`, { method: "POST" }));
    if (!suggestion) return;
    setQuestionGrades((current) => ({ ...current, [answer.questionId]: {
      ...current[answer.questionId],
      score: suggestion.suggestedScore ?? current[answer.questionId]?.score ?? "",
      feedback: suggestion.feedback,
      gradingStatus: "Suggested"
    } }));
  }

  async function suggestAllGrades() {
    if (!selectedSubmission) return;
    const result = await perform("Preparing advisory grades and feedback...", () => jsonFetch(`/api/dashboard/submissions/${selectedSubmission.id}/suggest-grades`, { method: "POST" }));
    if (!result) return;
    setQuestionGrades((current) => {
      const next = { ...current };
      result.suggestions.forEach((suggestion) => {
        next[suggestion.questionId] = {
          ...next[suggestion.questionId],
          score: suggestion.suggestedScore ?? next[suggestion.questionId]?.score ?? "",
          feedback: suggestion.feedback,
          gradingStatus: "Suggested"
        };
      });
      return next;
    });
    setNotice({ tone: "success", text: `${result.suggestions.length} draft suggestions prepared. Review and save each question to confirm the marks.` });
  }

  function downloadAnswerBook(kind, id) {
    const link = document.createElement("a");
    link.href = `${backendUrl}/api/dashboard/${kind}/${id}/answer-book`;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function downloadAnswerPdf(kind, id) {
    const link = document.createElement("a");
    link.href = `${backendUrl}/api/dashboard/${kind}/${id}/answer-book.pdf`;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function downloadSubmissionPdf(id) {
    const link = document.createElement("a");
    link.href = `${backendUrl}/api/dashboard/submissions/${id}/answer-book.pdf`;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function removeResource(kind, id, label) {
    if (!window.confirm(`Remove ${label}? Related student work may also be deleted.`)) return;
    await perform(`Removing ${label}...`, () => jsonFetch(`/api/dashboard/${kind}/${id}`, { method: "DELETE" }));
    if (kind === "submissions" && selectedSubmission?.id === id) setSelectedSubmission(null);
  }

  async function editExam(exam) {
    const fullExam = await perform("Loading exam editor...", () => jsonFetch(`/api/dashboard/exams/${exam.id}`));
    if (!fullExam) return;
    setEditingExamId(fullExam.id);
    setExamForm({ title: fullExam.title, language: fullExam.language, testType: fullExam.testType, durationMinutes: fullExam.durationMinutes });
    setQuestions((fullExam.questions || []).map(normalizeQuestion));
    setActiveView("exams");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelExamEdit() {
    setEditingExamId("");
    setEditingQuestionId("");
    setQuestions([]);
    setExamForm({ title: "", language: "Python", testType: "Coding", durationMinutes: 90 });
  }

  function editDraftQuestion(question) {
    setEditingQuestionId(question.id);
    setQuestionForm({
      format: question.format,
      title: question.title,
      prompt: question.prompt,
      points: question.points,
      starter: question.starter || "",
      answerGuide: question.answerGuide || "",
      optionsText: (question.options || []).join("\n")
    });
  }

  async function editSession(session) {
    const sessionName = window.prompt("Session name:", session.sessionName); if (sessionName == null) return;
    const accessCode = window.prompt("Access code:", session.accessCode); if (accessCode == null) return;
    const studentCount = window.prompt("Expected learners:", session.studentCount); if (studentCount == null) return;
    await perform("Updating session...", () => jsonFetch(`/api/dashboard/sessions/${session.id}`, { method: "PUT", body: JSON.stringify({ sessionName, accessCode, studentCount: Number(studentCount) }) }));
  }

  async function editStudent(student) {
    const fullName = window.prompt("Student full name:", student.fullName); if (fullName == null) return;
    const studentNumber = window.prompt("Student number:", student.studentNumber); if (studentNumber == null) return;
    const email = window.prompt("Email:", student.email || ""); if (email == null) return;
    await perform("Updating learner...", () => jsonFetch(`/api/dashboard/students/${student.id}`, { method: "PUT", body: JSON.stringify({ fullName, studentNumber, email }) }));
  }

  const metrics = [
    ["Published exams", overview.exams.length, "Assessment templates"],
    ["Live sessions", activeSessions.length, activeSessions.length ? "Students can enter now" : "No exam released"],
    ["Checked in", checkedIn, "Verified learners"],
    ["Awaiting grade", ungraded, "Submissions to review"]
  ];

  return (
    <div className="educator-app">
      <aside className="app-nav">
        <div className="brand-lockup"><span>EZ</span><div><strong>EzProctor</strong><small>Exam</small></div></div>
        <nav>{navItems.map(([id, label, number]) => <button key={id} className={activeView === id ? "active" : ""} onClick={() => setActiveView(id)}><span>{number}</span>{label}</button>)}</nav>
        <div className="nav-footer"><Status tone={socketState === "Live" ? "success" : "danger"}>{socketState}</Status><small>Educator Console</small></div>
      </aside>

      <main className="app-main">
        <header className="top-header">
          <div><p className="eyebrow">Assessment operations</p><h1>{navItems.find(([id]) => id === activeView)?.[1]}</h1></div>
          <div className="header-actions"><a href={`${backendUrl}/exam-mode`} target="_blank" rel="noreferrer" className="button secondary">Student entry</a><button className="button primary" onClick={() => setActiveView("sessions")}>Release an exam</button></div>
        </header>

        <div className={`notice notice-${notice.tone}`}>{notice.text}</div>

        {activeView === "overview" && <>
          <section className="metric-grid">{metrics.map(([label, value, copy]) => <article className="metric-card" key={label}><span>{label}</span><strong>{value}</strong><p>{copy}</p></article>)}</section>
          <section className="split-grid">
            <article className="surface feature-surface"><p className="eyebrow">Recommended next step</p><h2>{activeSessions.length ? "Monitor the live room" : overview.exams.length ? "Create and release a session" : "Import your first coding exam"}</h2><p>{activeSessions.length ? "Watch learner activity and collect submissions from the live monitoring view." : "Use a prepared CSV, JSON, Word file, or build questions manually."}</p><button className="button primary" onClick={() => setActiveView(activeSessions.length ? "monitor" : overview.exams.length ? "sessions" : "exams")}>Continue workflow</button></article>
            <article className="surface"><div className="section-title"><div><p className="eyebrow">Live room</p><h2>Session status</h2></div><Status tone={activeSessions.length ? "success" : "neutral"}>{activeSessions.length ? "Released" : "Standby"}</Status></div>
              {activeSessions.length ? activeSessions.map((session) => <div className="compact-row" key={session.id}><div><strong>{session.sessionName}</strong><span>{session.examTitle} · {session.durationMinutes} min</span></div><button onClick={() => { setSelectedSessionId(session.id); setActiveView("monitor"); }}>Open</button></div>) : <Empty title="No live session" copy="Release a scheduled session when learners are ready." />}
            </article>
          </section>
          <section className="surface"><div className="section-title"><div><p className="eyebrow">Four-step release</p><h2>From question file to student IDE</h2></div></div><div className="workflow-strip">{[["1", "Import", "Bring Python or HTML questions"], ["2", "Prepare", "Create session and roster"], ["3", "Release", "Open secure student access"], ["4", "Review", "Monitor and grade work"]].map(([n,t,c]) => <div key={n}><span>{n}</span><strong>{t}</strong><p>{c}</p></div>)}</div></section>
        </>}

        {activeView === "exams" && <section className="editor-layout">
          <form className="surface form-surface" onSubmit={createExam}>
            <div className="section-title"><div><p className="eyebrow">Exam builder</p><h2>Create coding assessment</h2></div><Status>{questions.length} questions</Status></div>
            <label>Exam title<input required value={examForm.title} onChange={(event) => setExamForm({ ...examForm, title: event.target.value })} placeholder="Python fundamentals assessment" /></label>
            <div className="form-grid"><label>Workspace<select value={examForm.language} onChange={(event) => setExamForm({ ...examForm, language: event.target.value })}><option>Python</option><option>HTML</option><option>Rust</option></select></label><label>Duration<input type="number" min="15" value={examForm.durationMinutes} onChange={(event) => setExamForm({ ...examForm, durationMinutes: Number(event.target.value) })} /></label></div>
            <label>Assessment style<select value={examForm.testType} onChange={(event) => setExamForm({ ...examForm, testType: event.target.value })}><option>Coding</option><option>Frontend</option><option>Debugging</option><option>Mixed Format</option></select></label>
            <div className="import-zone"><strong>Import prepared questions</strong><p>CSV, JSON, Word, Markdown or text. Python and HTML starter code is preserved.</p><label className="button secondary file-button">Choose question file<input type="file" accept=".csv,.json,.docx,.txt,.md" onChange={importQuestions} /></label></div>
            <button disabled={busy} className="button primary wide" type="submit">{editingExamId ? "Save exam changes" : "Save exam and continue"}</button>
            {editingExamId && <button className="button ghost wide" type="button" onClick={cancelExamEdit}>Cancel editing</button>}
          </form>
          <div className="content-stack">
            <form className="surface question-form" onSubmit={addManualQuestion}><div className="section-title"><div><p className="eyebrow">Manual entry</p><h2>{editingQuestionId ? "Edit question" : "Add a question"}</h2></div></div><div className="form-grid"><label>Format<select value={questionForm.format} onChange={(event) => setQuestionForm({ ...questionForm, format: event.target.value })}>{questionFormats.map((format) => <option key={format}>{format}</option>)}</select></label><label>Marks<input type="number" min="1" value={questionForm.points} onChange={(event) => setQuestionForm({ ...questionForm, points: Number(event.target.value) })} /></label></div><label>Question title<input value={questionForm.title} onChange={(event) => setQuestionForm({ ...questionForm, title: event.target.value })} placeholder="Question title" /></label><label>Instructions<textarea value={questionForm.prompt} onChange={(event) => setQuestionForm({ ...questionForm, prompt: event.target.value })} rows="4" placeholder="Describe the question..." /></label>{questionForm.format === "Multiple Choice" && <label>Answer choices (one per line)<textarea value={questionForm.optionsText} onChange={(event) => setQuestionForm({ ...questionForm, optionsText: event.target.value })} rows="5" placeholder={'First choice\nSecond choice\nThird choice'} /></label>}{["Coding","Frontend","Debugging"].includes(questionForm.format) && <label>Starter code<textarea className="code-input" value={questionForm.starter} onChange={(event) => setQuestionForm({ ...questionForm, starter: event.target.value })} rows="4" placeholder="Optional - leave blank for an empty student file" /></label>}<label>Model answer / marking guide (optional)<textarea value={questionForm.answerGuide} onChange={(event) => setQuestionForm({ ...questionForm, answerGuide: event.target.value })} rows="4" placeholder="Import or enter the expected answer and marking points for pre-grading" /></label><button className="button secondary" type="submit">{editingQuestionId ? "Update question" : "Add to draft"}</button></form>
            <section className="surface"><div className="section-title"><div><p className="eyebrow">Saved exams</p><h2>Manage exams</h2></div></div>{overview.exams.length ? <div className="export-list">{overview.exams.map((exam) => <article key={exam.id}><div><strong>{exam.title}</strong><p>{exam.language} · {exam.questions?.length || 0} questions · {(exam.questions || []).filter((question) => question.answerGuide).length} model answers</p></div><div className="row-actions"><label className="model-answer-button">Import answers<input type="file" accept=".docx,.txt,.md,.csv,.json" onChange={(event) => previewModelAnswers(exam, event)} /></label><button onClick={() => downloadAnswerPdf("exams", exam.id)}>PDF backup</button><button onClick={() => downloadAnswerBook("exams", exam.id)}>HTML</button><button onClick={() => editExam(exam)}>Edit</button><button className="danger-text" onClick={() => removeResource("exams", exam.id, "exam")}>Remove</button></div></article>)}</div> : <Empty title="No exams" copy="Create an exam before exporting answers." />}</section>
            <section className="surface"><div className="section-title"><div><p className="eyebrow">Draft paper</p><h2>Question sequence</h2></div></div>{questions.length ? <div className="list">{questions.map((question, index) => <article className="question-row" key={question.id}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{question.title}</strong><label className="inline-type-label">Type<select value={question.format} onChange={(event) => updateDraftQuestionType(question.id, event.target.value)}>{questionFormats.map((format) => <option key={format}>{format}</option>)}</select></label><p>{question.points} marks</p></div><div className="row-actions"><button onClick={() => editDraftQuestion(question)}>Edit</button><button className="danger-text" onClick={() => setQuestions((current) => current.filter((item) => item.id !== question.id))}>Remove</button></div></article>)}</div> : <Empty title="No questions in draft" copy="Import a file or add a question manually." />}</section>
          </div>
        </section>}

        {activeView === "sessions" && <section className="content-stack">
          <section className="split-grid"><form className="surface" onSubmit={createSession}><div className="section-title"><div><p className="eyebrow">New sitting</p><h2>Create exam session</h2></div></div><label>Exam<select required value={sessionForm.examId} onChange={(event) => setSessionForm({ ...sessionForm, examId: event.target.value })}><option value="">Choose an exam</option>{overview.exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.title} · {exam.language}</option>)}</select></label><label>Session name<input value={sessionForm.sessionName} onChange={(event) => setSessionForm({ ...sessionForm, sessionName: event.target.value })} placeholder="Auto-created if blank" /></label><label>Expected learners<input type="number" min="1" value={sessionForm.studentCount} onChange={(event) => setSessionForm({ ...sessionForm, studentCount: Number(event.target.value) })} /></label><button className="button primary" type="submit">Create scheduled session</button></form>
          <article className="surface release-card"><p className="eyebrow">Student access</p><h2>Release controls</h2><p>Select a session, assign learners, then release. Only one session stays active so students always enter the correct exam.</p><label>Selected session<select value={selectedSessionId} onChange={(event) => setSelectedSessionId(event.target.value)}><option value="">Choose session</option>{overview.sessions.map((session) => <option key={session.id} value={session.id}>{session.sessionName} · {session.status}</option>)}</select></label><div className="release-stats"><div><strong>{assignedIds.size}</strong><span>Assigned</span></div><div><strong>{overview.roster.length}</strong><span>Roster</span></div></div><div className="button-row"><button className="button secondary" onClick={assignAll}>Assign all</button><button disabled={!selectedSessionId} className="button primary" onClick={() => releaseSession(selectedSessionId)}>Release to students</button></div>{selectedSession?.status === "Active" && <button className="button danger wide" onClick={() => closeSession(selectedSession.id)}>Close and collect submissions</button>}</article></section>
          <section className="surface"><div className="section-title"><div><p className="eyebrow">All sittings</p><h2>Session management</h2></div><Status>{overview.sessions.length} sessions</Status></div>{overview.sessions.length ? <div className="session-table">{overview.sessions.map((session) => <article key={session.id}><div className="session-state"><span className={`state-dot ${session.status.toLowerCase()}`}></span><div><strong>{session.sessionName}</strong><p>{session.examTitle} · {session.durationMinutes} min · Code {session.accessCode}</p></div></div><Status tone={session.status === "Active" ? "success" : session.status === "Closed" ? "neutral" : "warning"}>{session.status}</Status><div className="row-actions"><button onClick={() => downloadAnswerPdf("sessions", session.id)}>PDF backup</button><button onClick={() => downloadAnswerBook("sessions", session.id)}>HTML</button><button onClick={() => editSession(session)}>Edit</button><button onClick={() => { setSelectedSessionId(session.id); assignAll(session.id); }}>Assign</button>{session.status === "Active" ? <button onClick={() => closeSession(session.id)}>Close</button> : <button onClick={() => releaseSession(session.id)}>Release</button>}<button className="danger-text" onClick={() => removeResource("sessions", session.id, "session")}>Remove</button></div></article>)}</div> : <Empty title="No sessions" copy="Create a session from an exam template." />}</section>
        </section>}

        {activeView === "learners" && <section className="split-grid learner-layout"><section className="content-stack"><form className="surface" onSubmit={createStudent}><div className="section-title"><div><p className="eyebrow">Roster</p><h2>Add learner</h2></div></div><label>Student number<input required value={studentForm.studentNumber} onChange={(event) => setStudentForm({ ...studentForm, studentNumber: event.target.value })} placeholder="STU1001" /></label><label>Full name<input required value={studentForm.fullName} onChange={(event) => setStudentForm({ ...studentForm, fullName: event.target.value })} placeholder="Student name" /></label><label>Email<input type="email" value={studentForm.email} onChange={(event) => setStudentForm({ ...studentForm, email: event.target.value })} placeholder="student@example.com" /></label><button className="button primary" type="submit">Add learner</button></form><div className="surface import-zone"><strong>Bulk import roster</strong><p>Upload CSV columns: studentNumber, fullName, email.</p><label className="button secondary file-button">Import learner CSV<input type="file" accept=".csv" onChange={importStudents} /></label></div></section>
          <section className="surface"><div className="section-title"><div><p className="eyebrow">Class list</p><h2>{overview.roster.length} learners</h2></div></div>{overview.roster.length ? <div className="learner-list">{overview.roster.map((student) => <article key={student.id}><span className="avatar">{student.fullName.split(" ").map((part) => part[0]).slice(0,2).join("")}</span><div><strong>{student.fullName}</strong><p>{student.studentNumber} · {student.email || "No email"}</p></div><div className="row-actions"><button onClick={() => editStudent(student)}>Edit</button><button className="danger-text" onClick={() => removeResource("students", student.id, "learner and work")}>Remove</button></div></article>)}</div> : <Empty title="Roster is empty" copy="Add one learner or import the class CSV." />}</section></section>}

        {activeView === "monitor" && <section className="content-stack">
          <section className="metric-grid monitor-metrics"><article className="metric-card"><span>In secure IDE</span><strong>{overview.students.length}</strong><p>Live activity streams</p></article><article className="metric-card"><span>Submitted</span><strong>{overview.submissions.length}</strong><p>Collected responses</p></article><article className="metric-card"><span>High risk</span><strong>{overview.students.filter((student) => Number(student.riskScore) >= 70).length}</strong><p>Needs educator attention</p></article><article className="metric-card"><span>Awaiting grade</span><strong>{ungraded}</strong><p>Ready to review</p></article></section>
          <section className="surface"><div className="section-title"><div><p className="eyebrow">Live activity</p><h2>Student workspace monitor</h2></div><Status tone={overview.students.length ? "success" : "neutral"}>{overview.students.length ? "Receiving events" : "Waiting"}</Status></div>{overview.students.length ? <div className="monitor-grid">{overview.students.map((student) => <article key={student.studentId}><div className="card-heading"><div><strong>{student.studentName}</strong><p>{student.currentActivity}</p></div><Status tone={Number(student.riskScore) >= 70 ? "danger" : Number(student.riskScore) >= 40 ? "warning" : "success"}>{100 - Number(student.riskScore || 0)} integrity</Status></div><div className="progress-track"><span style={{ width: `${student.progress || 0}%` }}></span></div><div className="mini-metrics"><span>{student.progress || 0}% progress</span><span>{student.violations || 0} signals</span><span>{student.submitted ? "Submitted" : "Working"}</span></div></article>)}</div> : <Empty title="No students in IDE" copy="Release a session and student activity will appear here." />}</section>
          <section className="surface"><div className="section-title"><div><p className="eyebrow">Assessment review</p><h2>Submissions and grading</h2></div><Status>{overview.submissions.length} collected</Status></div>{overview.submissions.length ? <div className="submission-list">{overview.submissions.map((submission) => <article key={submission.id}><div><strong>{submission.fullName}</strong><p>{submission.examTitle} · {new Date(submission.submittedAt).toLocaleString()}</p></div><Status tone={submission.reviewedAt ? "success" : "warning"}>{submission.gradeStatus || "Pending Review"}</Status><strong>{submission.gradeScore ?? "--"}</strong><div className="row-actions"><button onClick={() => openSubmission(submission.id)}>Grade</button><button onClick={() => downloadSubmissionPdf(submission.id)}>Export PDF</button><button className="danger-text" onClick={() => removeResource("submissions", submission.id, "student work")}>Remove</button></div></article>)}</div> : <Empty title="No submissions" copy="Submitted work will be available for grading here." />}</section>
        </section>}
      </main>

      {answerImportPreview && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setAnswerImportPreview(null)}><section className="answer-map-modal"><div className="section-title"><div><p className="eyebrow">Review answer mapping</p><h2>{answerImportPreview.examTitle}</h2><p>{answerImportPreview.fileName} · {answerImportPreview.matches.length} matched · {answerImportPreview.unmatched.length} unmatched</p></div><button className="icon-button" onClick={() => setAnswerImportPreview(null)}>Close</button></div><div className="answer-map-list">{answerImportPreview.matches.map((match) => <article key={`${match.questionId}-${match.sourceIndex}`}><div className="answer-map-number">{match.questionNumber}</div><div><strong>{match.questionTitle}</strong><p>{match.sourceLabel} mapped by {match.method}</p><pre>{match.answerGuide}</pre></div><Status tone={match.confidence === "Review" ? "warning" : "success"}>{match.confidence}</Status></article>)}</div>{answerImportPreview.unmatched.length > 0 && <details className="unmatched-answers" open><summary>{answerImportPreview.unmatched.length} answers need manual review</summary>{answerImportPreview.unmatched.map((entry) => <p key={entry.sourceIndex}><strong>{entry.questionNumber ? `Question ${entry.questionNumber}` : entry.title || `Answer ${entry.sourceIndex + 1}`}:</strong> {entry.reason}</p>)}</details>}<div className="answer-map-actions"><p>Applying updates only the model-answer guides. It does not grade or change student work.</p><button className="button primary" disabled={!answerImportPreview.matches.length} onClick={applyModelAnswers}>Apply model answers</button></div></section></div>}
      {selectedSubmission && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSelectedSubmission(null)}><section className="grade-modal"><div className="section-title"><div><p className="eyebrow">Question-by-question grading</p><h2>{selectedSubmission.fullName}</h2><p>{selectedSubmission.examTitle} · {selectedSubmission.sessionName}</p></div><button className="icon-button" onClick={() => setSelectedSubmission(null)}>Close</button></div><div className="grading-summary"><div><span>Answered</span><strong>{selectedSubmission.questionAnswers.filter((answer) => answer.answered).length}/{selectedSubmission.questionAnswers.length}</strong></div><div><span>Graded total</span><strong>{selectedSubmission.questionAnswers.reduce((sum, answer) => sum + Number(answer.score || 0), 0)}/{selectedSubmission.maximumScore}</strong></div></div><div className="grading-assistant-bar"><div><strong>Advisory pre-grading</strong><p>Suggestions stay unsaved until you confirm each question.</p></div><button className="button secondary" onClick={suggestAllGrades}>Prepare all suggestions</button></div><div className="question-grading-list">{selectedSubmission.questionAnswers.map((answer) => <article className="question-grade-card" key={answer.questionId}><header><div><span>Question {answer.questionNumber}</span><h3>{answer.title}</h3><p>{answer.prompt}</p></div><Status tone={answer.answered ? "success" : "warning"}>{answer.answered ? `Latest answer · ${new Date(answer.updatedAt).toLocaleString()}` : "Not answered"}</Status></header>{answer.answered && <div className="answer-evidence">{answer.answerText && <div><strong>Written answer</strong><pre>{answer.answerText}</pre></div>}{answer.selectedOption !== "" && <div><strong>Selected answer</strong><pre>{`${String.fromCharCode(65 + Number(answer.selectedOption))}. ${answer.options?.[Number(answer.selectedOption)] || ""}`}</pre></div>}{Object.entries(answer.files || {}).map(([name, content]) => <details key={name} open><summary>{name}</summary><pre>{content}</pre></details>)}{answer.stdinText && <div><strong>Test input</strong><pre>{answer.stdinText}</pre></div>}{Object.keys(answer.files || {}).length > 0 && <div><strong>Latest test result</strong><pre>{answer.result ? [answer.result.stdout, answer.result.stderr].filter(Boolean).join("\n") || "Completed without output." : "Student has not run this answer yet."}</pre></div>}</div>}{answer.answerGuide && <details className="marking-guide"><summary>Imported model answer / marking guide</summary><pre>{answer.answerGuide}</pre></details>}<div className="question-grade-form"><button className="button secondary suggest-grade-button" type="button" disabled={!answer.answered || !answer.answerGuide} onClick={() => suggestQuestionGrade(answer)}>Suggest grade</button><label>Marks (max {answer.points})<input type="number" min="0" max={answer.points} step="0.5" value={questionGrades[answer.questionId]?.score ?? ""} onChange={(event) => setQuestionGrades((current) => ({ ...current, [answer.questionId]: { ...current[answer.questionId], score: event.target.value } }))} /></label><label>Feedback<textarea rows="2" value={questionGrades[answer.questionId]?.feedback || ""} onChange={(event) => setQuestionGrades((current) => ({ ...current, [answer.questionId]: { ...current[answer.questionId], feedback: event.target.value, gradingStatus: "Graded" } }))} /></label><div className="grade-confirm"><Status tone={questionGrades[answer.questionId]?.gradingStatus === "Suggested" ? "warning" : "neutral"}>{questionGrades[answer.questionId]?.gradingStatus === "Suggested" ? "Draft suggestion" : answer.gradingStatus || "Pending"}</Status><button className="button secondary" onClick={() => saveQuestionGrade(answer)}>Confirm Q{answer.questionNumber}</button></div></div></article>)}</div><form className="grade-form" onSubmit={saveGrade}><div className="form-grid"><label>Final score<input type="number" min="0" max={selectedSubmission.maximumScore || 100} step="0.5" value={gradeForm.gradeScore} onChange={(event) => setGradeForm({ ...gradeForm, gradeScore: event.target.value })} /></label><label>Overall status<select value={gradeForm.gradeStatus} onChange={(event) => setGradeForm({ ...gradeForm, gradeStatus: event.target.value })}><option>Pending Review</option><option>Reviewed</option><option>Needs Follow-up</option><option>Graded</option></select></label></div><label>Overall feedback<textarea rows="3" value={gradeForm.teacherFeedback} onChange={(event) => setGradeForm({ ...gradeForm, teacherFeedback: event.target.value })} /></label><div className="final-grade-actions"><button className="button secondary" type="button" onClick={() => downloadSubmissionPdf(selectedSubmission.id)}>Export student PDF</button><button className="button primary" type="submit">Save all grades</button></div></form></section></div>}
    </div>
  );
}

export default App;
