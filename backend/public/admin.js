const state = {
  exams: [],
  sessions: [],
  roster: [],
  registrations: [],
  students: [],
  submissions: [],
  loadError: "",
  socketState: "Connecting",
  selectedSubmission: null,
  selectedSubmissionFile: "",
  gradeSaveState: "No grade saved yet.",
  examDraftQuestions: [],
  quickOpsStatus: "Quick operations ready."
};

function badgeClass(score) {
  if (score >= 70) return "critical";
  if (score >= 40) return "warning";
  return "normal";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }

  return data;
}

async function fileToBase64(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const slice = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...slice);
  }

  return btoa(binary);
}

function emptyCard(title, body) {
  return `<article class="empty"><strong>${title}</strong><div class="meta">${body}</div></article>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function fillSelect(id, items, valueKey, labelFn) {
  const select = document.getElementById(id);
  const currentValue = select.value;
  select.innerHTML = `<option value="">Choose</option>`;
  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = item[valueKey];
    option.textContent = labelFn(item);
    select.appendChild(option);
  });
  if (items.some((item) => item[valueKey] === currentValue)) {
    select.value = currentValue;
  } else if (items[0]) {
    select.value = items[0][valueKey];
  }
}

function examById(id) {
  return state.exams.find((exam) => exam.id === id) || null;
}

function buildDefaultSessionName(exam) {
  const today = new Date();
  const stamp = today.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short"
  });
  return `${exam?.title || "Exam"} - ${stamp}`;
}

function setQuickOpsStatus(message) {
  state.quickOpsStatus = message;
  const node = document.getElementById("quickOpsStatus");
  if (node) {
    node.textContent = message;
  }
}

function getPreferredExamForQuickOps() {
  const selected = document.getElementById("sessionExamId")?.value;
  if (selected) {
    return examById(selected);
  }
  return state.exams[0] || null;
}

function getPreferredSessionForQuickOps() {
  const selected = document.getElementById("registrationSessionId")?.value;
  if (selected) {
    return state.sessions.find((session) => session.id === selected) || null;
  }
  return state.sessions[0] || null;
}

function syncDurationInputs(value) {
  const normalized = String(value || "90");
  const main = document.getElementById("examDurationInput");
  const advanced = document.getElementById("examDurationAdvanced");
  if (main) {
    main.value = normalized;
  }
  if (advanced) {
    advanced.value = normalized;
  }
}

function applyDetectedMetadata(metadata = {}) {
  const typeSelect = document.querySelector('select[name="testType"]');
  const languageSelect = document.querySelector('select[name="language"]');
  const metadataText = document.getElementById("questionDocMetadata");

  if (metadata.detectedTestType && [...typeSelect.options].some((option) => option.value === metadata.detectedTestType)) {
    typeSelect.value = metadata.detectedTestType;
  }

  if (metadata.detectedLanguage && [...languageSelect.options].some((option) => option.value === metadata.detectedLanguage)) {
    languageSelect.value = metadata.detectedLanguage;
  }

  if (metadata.detectedDurationMinutes) {
    syncDurationInputs(metadata.detectedDurationMinutes);
  }

  if (metadataText) {
    metadataText.textContent = `Detected: ${metadata.detectedTestType || "Unknown format"} | ${metadata.detectedLanguage || "Unknown language"} | ${metadata.detectedDurationMinutes || "No time found"} min`;
  }
}

function questionIcon(format) {
  switch (format) {
    case "Multiple Choice":
      return "MCQ";
    case "Short Answer":
      return "Text";
    case "Database":
      return "SQL";
    case "Frontend":
      return "UI";
    case "Debugging":
      return "Fix";
    default:
      return "Code";
  }
}

function collectQuestionDraft() {
  const format = document.getElementById("questionFormat").value;
  const title = document.getElementById("questionTitle").value.trim();
  const prompt = document.getElementById("questionPrompt").value.trim();
  const points = Number(document.getElementById("questionPoints").value || 10);
  const options = document.getElementById("questionOptions").value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const starter = document.getElementById("questionStarter").value.trim();
  const answerGuide = document.getElementById("questionAnswerGuide").value.trim();

  if (!title || !prompt) {
    return null;
  }

  return {
    id: `question-${crypto.randomUUID().slice(0, 8)}`,
    format,
    title,
    prompt,
    points: Number.isFinite(points) && points > 0 ? points : 10,
    options,
    starter,
    answerGuide
  };
}

function normalizeImportedQuestion(question, index) {
  const format = String(question?.format || "Coding").trim() || "Coding";
  const options = Array.isArray(question?.options)
    ? question.options
    : String(question?.options || "")
        .split(/\r?\n|\|/)
        .map((item) => item.trim())
        .filter(Boolean);

  return {
    id: String(question?.id || `question-${crypto.randomUUID().slice(0, 8)}`),
    format,
    title: String(question?.title || `${format} Question ${index + 1}`).trim(),
    section: String(question?.section || "").trim(),
    prompt: String(question?.prompt || "").trim(),
    points: Number(question?.points || 10),
    options,
    starter: String(question?.starter || "").trim(),
    answerGuide: String(question?.answerGuide || "").trim()
  };
}

function appendDraftQuestions(questions = []) {
  state.examDraftQuestions = [
    ...state.examDraftQuestions,
    ...questions
      .map(normalizeImportedQuestion)
      .filter((question) => question.title && question.prompt)
  ];
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function downloadQuestionTemplate() {
  const csv = [
    "format,title,prompt,points,options,starter,answerGuide",
    '"Coding","Input Validation Function","Write a function that validates a student ID string and returns True only for the expected format.",20,"","def is_valid_student_id(value): pass","Check exact format and return a boolean."',
    '"Multiple Choice","Loop Output","Which loop will iterate exactly five times?",5,"for i in range(5)|while True|for i in range(1, 5)|loop(5)","","for i in range(5)"',
    '"Short Answer","Complexity Reflection","Explain why binary search is O(log n).",10,"","","Halves the search space each step."',
    '"Database","Student Query","Write an SQL query that returns all students with marks above 80.",15,"","SELECT * FROM students WHERE mark > 80;","Uses a correct SELECT with filter condition."',
    '"Frontend","Accessible Form","Build a simple accessible login form with labels and validation placeholders.",20,"","<form>...</form>","Uses semantic inputs and clear labels."'
  ].join("\n");

  const blob = new Blob([csv], {
    type: "text/csv;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "cloudide-proctor-question-template.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function parseImportedQuestions(fileName, text) {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".json")) {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (Array.isArray(parsed.questions)) {
      return parsed.questions;
    }
    throw new Error("JSON must be an array of questions or an object with a questions array.");
  }

  if (lowerName.endsWith(".csv")) {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) {
      return [];
    }

    const headers = parseCsvLine(lines[0]);
    return lines.slice(1).map((line) => {
      const values = parseCsvLine(line);
      const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
      return {
        format: row.format,
        title: row.title,
        prompt: row.prompt,
        points: row.points,
        options: row.options ? row.options.split("|").map((item) => item.trim()).filter(Boolean) : [],
        starter: row.starter,
        answerGuide: row.answerGuide
      };
    });
  }

  throw new Error("Use the guided CSV template or a JSON question file for import.");
}

function resetQuestionDraftForm() {
  document.getElementById("questionFormat").value = "Coding";
  document.getElementById("questionTitle").value = "";
  document.getElementById("questionPrompt").value = "";
  document.getElementById("questionPoints").value = "10";
  document.getElementById("questionOptions").value = "";
  document.getElementById("questionStarter").value = "";
  document.getElementById("questionAnswerGuide").value = "";
}

function renderQuestionDrafts() {
  const draftCount = document.getElementById("questionDraftCount");
  const draftList = document.getElementById("questionDraftList");
  draftCount.textContent = `${state.examDraftQuestions.length} question${state.examDraftQuestions.length === 1 ? "" : "s"}`;

  draftList.innerHTML = state.examDraftQuestions.length
    ? state.examDraftQuestions
        .map(
          (question, index) => `
            <article class="list-row question-row">
              <div class="question-row-head">
                <span class="question-badge">${questionIcon(question.format)}</span>
                <strong>${index + 1}. ${question.title}</strong>
              </div>
              <div class="meta">${question.section ? `${escapeHtml(question.section)} | ` : ""}${question.format} | ${question.points} points</div>
              <div class="meta">${escapeHtml(question.prompt)}</div>
              ${question.options?.length ? `<div class="meta">Options: ${question.options.map(escapeHtml).join(" | ")}</div>` : ""}
              <div class="submission-actions">
                <button class="ghost-button danger-button" data-action="remove-question" data-id="${question.id}" type="button">Remove</button>
              </div>
            </article>
          `
        )
        .join("")
    : emptyCard("No questions yet", "Add one or more questions to shape the exam template before saving.");
}

function render() {
  fillSelect("sessionExamId", state.exams, "id", (item) => item.title);
  fillSelect("registrationSessionId", state.sessions, "id", (item) => `${item.sessionName} (${item.accessCode})`);
  fillSelect("registrationStudentId", state.roster, "id", (item) => `${item.fullName} (${item.studentNumber})`);

  document.getElementById("examList").innerHTML = state.exams
    .map(
      (exam) => `
        <article class="list-row">
          <strong>${exam.title}</strong>
          <div class="meta">${exam.testType} | ${exam.language} | ${exam.durationMinutes} min | ${exam.questions?.length || 0} questions | ${exam.status}</div>
          ${
            exam.questions?.length
              ? `<div class="question-summary-strip">${exam.questions
                  .map((question) => `<span class="question-pill">${questionIcon(question.format)} ${escapeHtml(question.title)}</span>`)
                  .join("")}</div>`
              : ""
          }
          <div class="submission-actions">
            <button class="ghost-button danger-button" data-action="delete-exam" data-id="${exam.id}" type="button">Delete</button>
          </div>
        </article>
      `
    )
    .join("") || emptyCard("No exams yet", "Create the first exam to start scheduling sessions.");

  document.getElementById("sessionList").innerHTML = state.sessions
    .map(
      (session) => `
        <article class="list-row">
          <strong>${session.sessionName}</strong>
          <div class="meta">${session.examTitle || session.examId} | Access ${session.accessCode} | ${session.status} | ${session.durationMinutes} min</div>
          <div class="action-row">
            <button data-action="start" data-id="${session.id}">Start</button>
            <button data-action="stop" data-id="${session.id}">Stop</button>
            <button class="ghost-button danger-button" data-action="delete-session" data-id="${session.id}" type="button">Delete</button>
          </div>
        </article>
      `
    )
    .join("") || emptyCard("No sessions yet", "Create a session after you have an exam.");

  document.getElementById("studentList").innerHTML = state.roster
    .map(
      (student) => `
        <article class="list-row">
          <strong>${student.fullName}</strong>
          <div class="meta">${student.studentNumber} | ${student.identityStatus}</div>
          <div class="submission-actions">
            <button class="ghost-button danger-button" data-action="delete-student" data-id="${student.id}" type="button">Delete</button>
          </div>
        </article>
      `
    )
    .join("") || emptyCard("No students yet", "Add students before registration.");

  document.getElementById("registrationList").innerHTML = state.registrations
    .map(
      (registration) => `
        <article class="list-row">
          <strong>${registration.fullName}</strong>
          <div class="meta">${registration.sessionName} | Access ${registration.accessCode} | Verify ${registration.verificationCode} | ${registration.approvalStatus}</div>
          <div class="submission-actions">
            <button class="ghost-button danger-button" data-action="delete-registration" data-id="${registration.id}" type="button">Delete</button>
          </div>
        </article>
      `
    )
    .join("") || emptyCard("No registrations yet", "Register a student to generate access and verification codes.");

  const checkedInStudents = state.registrations.filter((registration) => registration.identityVerified);
  document.getElementById("approvalList").innerHTML = checkedInStudents
    .map(
      (registration) => `
        <article class="list-row">
          <strong>${registration.fullName}</strong>
          <div class="meta">${registration.studentNumber} | ${registration.sessionName} | Seat ${registration.seatLabel || "Not set"}</div>
          <div class="meta">Checked in ${registration.lastLoginAt || "just now"} | Lobby ready</div>
          <div class="submission-actions">
            <button class="ghost-button danger-button" data-action="reject-registration" data-id="${registration.id}" type="button">Reject Request</button>
          </div>
        </article>
      `
    )
    .join("") || emptyCard("No students waiting", "Checked-in students will appear here until the session starts.");

  document.getElementById("activityList").innerHTML = state.students
    .map(
      (student) => `
        <article class="card">
          <div class="panel-head">
            <div>
              <h3>${student.studentName}</h3>
              <div class="meta">${student.examId}</div>
            </div>
            <span class="badge ${badgeClass(student.riskScore)}">${student.status}</span>
          </div>
          <div class="metrics">
            <div class="metric"><span class="meta">Progress</span><strong>${student.progress}%</strong></div>
            <div class="metric"><span class="meta">Violations</span><strong>${student.violations}</strong></div>
            <div class="metric"><span class="meta">Integrity</span><strong>${100 - student.riskScore}</strong></div>
          </div>
          <div class="meta">Activity: ${student.currentActivity}</div>
          <div class="meta">Signals: ${student.signals?.length ? student.signals.join(", ") : "No elevated signals"}</div>
          <div class="meta">Submission: ${student.submitted ? "Submitted" : "In progress"}</div>
        </article>
      `
    )
    .join("") || emptyCard("No active students", "Live student activity cards will appear here once a student opens the IDE.");

  document.getElementById("submissionList").innerHTML = state.submissions.length
    ? state.submissions
        .map(
          (submission) => `
            <article class="list-row">
              <strong>${submission.fullName}</strong>
              <div class="meta">${submission.examTitle} | ${submission.sessionName} | ${submission.submittedAt} | ${submission.status}</div>
              <div class="meta">Review ${submission.gradeStatus || "Pending Review"} | Score ${submission.gradeScore ?? "--"}</div>
              <div class="submission-actions">
                <button class="ghost-button" data-action="view-submission" data-id="${submission.id}" type="button">View</button>
                <a class="ghost-button" href="/api/dashboard/submissions/${submission.id}/download">Download</a>
              </div>
            </article>
          `
        )
        .join("")
    : emptyCard("No submissions yet", "Final student submissions will appear here.");

  document.getElementById("activeCount").textContent = `${state.students.length} active`;
  document.getElementById("submissionCount").textContent = `${state.submissions.length} recorded`;
  document.getElementById("examCount").textContent = `${state.exams.length} exams`;
  document.getElementById("sessionCount").textContent = `${state.sessions.length} sessions`;
  document.getElementById("summaryExams").textContent = state.exams.length;
  document.getElementById("summaryLiveSessions").textContent = state.sessions.filter((item) => item.status === "Active").length;
  document.getElementById("summarySubmissions").textContent = state.submissions.length;
  document.getElementById("summaryHighRisk").textContent = state.students.filter((item) => Number(item.riskScore) >= 70).length;
  document.getElementById("summaryPendingApproval").textContent = checkedInStudents.length;
  document.getElementById("approvalCount").textContent = `${checkedInStudents.length} waiting`;
  document.getElementById("apiState").textContent = state.loadError ? "API Error" : "API Ready";
  document.getElementById("socketState").textContent = `Socket ${state.socketState}`;
  document.getElementById("errorText").hidden = !state.loadError;
  document.getElementById("errorText").textContent = state.loadError;
  const quickOpsNode = document.getElementById("quickOpsStatus");
  if (quickOpsNode) {
    quickOpsNode.textContent = state.quickOpsStatus;
  }
  renderQuestionDrafts();
  renderSubmissionInspector();
}

function renderSubmissionInspector() {
  const inspector = document.getElementById("submissionInspector");
  const fileSelect = document.getElementById("submissionFileSelect");
  const codeViewer = document.getElementById("submissionCode");
  const inspectorMeta = document.getElementById("inspectorMeta");
  const downloadLink = document.getElementById("downloadSubmission");
  const gradeScore = document.getElementById("gradeScore");
  const gradeStatus = document.getElementById("gradeStatus");
  const teacherFeedback = document.getElementById("teacherFeedback");
  const gradeSavedState = document.getElementById("gradeSavedState");
  const reviewStatusSummary = document.getElementById("reviewStatusSummary");
  const reviewMeta = document.getElementById("reviewMeta");

  if (!state.selectedSubmission) {
    inspector.hidden = true;
    return;
  }

  inspector.hidden = false;
  inspectorMeta.textContent = `${state.selectedSubmission.fullName} | ${state.selectedSubmission.examTitle} | ${state.selectedSubmission.sessionName} | ${state.selectedSubmission.submittedAt}`;
  downloadLink.href = `/api/dashboard/submissions/${state.selectedSubmission.id}/download`;
  gradeScore.value = state.selectedSubmission.gradeScore ?? "";
  gradeStatus.value = state.selectedSubmission.gradeStatus || "Pending Review";
  teacherFeedback.value = state.selectedSubmission.teacherFeedback || "";
  gradeSavedState.textContent = state.gradeSaveState;
  reviewStatusSummary.textContent = state.selectedSubmission.gradeStatus || "Pending Review";
  reviewMeta.textContent = state.selectedSubmission.reviewedAt
    ? `Reviewed ${state.selectedSubmission.reviewedAt}${state.selectedSubmission.gradeScore != null ? ` | Score ${state.selectedSubmission.gradeScore}` : ""}`
    : "This submission has not been graded yet.";

  const fileNames = Object.keys(state.selectedSubmission.files || {});
  fileSelect.innerHTML = fileNames.map((name) => `<option value="${name}">${name}</option>`).join("");

  if (!fileNames.includes(state.selectedSubmissionFile)) {
    state.selectedSubmissionFile = fileNames[0] || "";
  }

  if (state.selectedSubmissionFile) {
    fileSelect.value = state.selectedSubmissionFile;
    codeViewer.innerHTML = escapeHtml(state.selectedSubmission.files[state.selectedSubmissionFile]);
  } else {
    codeViewer.textContent = "This submission does not contain any files.";
  }
}

async function refresh() {
  try {
    const overview = await api("/api/dashboard/overview");
    state.exams = overview.exams || [];
    state.sessions = overview.sessions || [];
    state.roster = overview.roster || [];
    state.registrations = overview.registrations || [];
    state.students = overview.students || [];
    state.submissions = overview.submissions || [];
    state.loadError = "";
  } catch (error) {
    console.error(error);
    state.loadError = `Failed to load dashboard overview. ${error.message}`;
  }

  render();
}

async function openSubmission(submissionId) {
  try {
    const submission = await api(`/api/dashboard/submissions/${submissionId}`);
    state.selectedSubmission = submission;
    state.selectedSubmissionFile = Object.keys(submission.files || {})[0] || "";
    state.gradeSaveState = submission.reviewedAt ? "Loaded saved grade." : "No grade saved yet.";
    state.loadError = "";
  } catch (error) {
    console.error(error);
    state.loadError = `Failed to load submission details. ${error.message}`;
  }

  render();
}

async function saveGrade(event) {
  event.preventDefault();
  if (!state.selectedSubmission) {
    return;
  }

  const payload = {
    gradeScore: document.getElementById("gradeScore").value,
    gradeStatus: document.getElementById("gradeStatus").value,
    teacherFeedback: document.getElementById("teacherFeedback").value
  };

  try {
    const submission = await api(`/api/dashboard/submissions/${state.selectedSubmission.id}/grade`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    state.selectedSubmission = submission;
    state.gradeSaveState = "Grade saved.";
    await refresh();
  } catch (error) {
    console.error(error);
    state.gradeSaveState = `Save failed: ${error.message}`;
    renderSubmissionInspector();
  }
}

document.getElementById("examForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  await api("/api/dashboard/exams", {
    method: "POST",
    body: JSON.stringify({
      ...Object.fromEntries(form.entries()),
      questions: state.examDraftQuestions
    })
  });
  event.target.reset();
  state.examDraftQuestions = [];
  resetQuestionDraftForm();
  await refresh();
});

document.querySelectorAll("[data-duration]").forEach((button) => {
  button.addEventListener("click", () => {
    syncDurationInputs(button.getAttribute("data-duration"));
  });
});

document.getElementById("examDurationInput").addEventListener("input", (event) => {
  syncDurationInputs(event.target.value);
});

document.getElementById("examDurationAdvanced").addEventListener("input", (event) => {
  syncDurationInputs(event.target.value);
});

document.getElementById("addQuestionButton").addEventListener("click", () => {
  const draft = collectQuestionDraft();
  if (!draft) {
    state.loadError = "Add a question title and prompt before saving it to the exam.";
    render();
    return;
  }

  state.loadError = "";
  state.examDraftQuestions = [...state.examDraftQuestions, draft];
  resetQuestionDraftForm();
  renderQuestionDrafts();
  render();
});

document.getElementById("clearQuestionDraftButton").addEventListener("click", () => {
  resetQuestionDraftForm();
  state.loadError = "";
  render();
});

document.getElementById("downloadQuestionTemplateButton").addEventListener("click", downloadQuestionTemplate);

document.getElementById("importQuestionFileButton").addEventListener("click", async () => {
  const status = document.getElementById("questionImportStatus");
  const input = document.getElementById("questionImportFile");
  const file = input.files?.[0];

  if (!file) {
    status.textContent = "Choose a JSON or CSV question file first.";
    return;
  }

  try {
    const text = await file.text();
    const importedQuestions = parseImportedQuestions(file.name, text);
    appendDraftQuestions(importedQuestions);
    status.textContent = `Imported ${importedQuestions.length} questions into the builder.`;
    input.value = "";
    render();
  } catch (error) {
    status.textContent = `Import failed: ${error.message}`;
  }
});

document.getElementById("importWordButton").addEventListener("click", async () => {
  const status = document.getElementById("questionDocImportStatus");
  const input = document.getElementById("questionDocImportFile");
  const file = input.files?.[0];

  if (!file) {
    status.textContent = "Choose a .docx, .txt, or .md file first.";
    return;
  }

  status.textContent = "Reading and summarizing document...";

  try {
    const payload = {
      fileName: file.name,
      contentBase64: await fileToBase64(file),
      title: document.querySelector('input[name="title"]').value,
      testType: document.querySelector('select[name="testType"]').value,
      language: document.querySelector('select[name="language"]').value,
      durationMinutes: document.querySelector('input[name="durationMinutes"]').value,
      questionCount: 4
    };

    const result = await api("/api/dashboard/questions/import-document", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    appendDraftQuestions(result.questions || []);
    applyDetectedMetadata(result.metadata || {});
    input.value = "";
    status.textContent =
      result.mode === "ai"
        ? `Imported and summarized document into ${result.questions?.length || 0} questions.`
        : `Imported document using fallback summary mode. ${result.questions?.length || 0} draft questions were created.`;
    render();
  } catch (error) {
    status.textContent = `Document import failed: ${error.message}`;
  }
});

document.getElementById("generateAiQuestionsButton").addEventListener("click", async () => {
  const status = document.getElementById("questionAiStatus");
  status.textContent = "Generating questions...";

  const payload = {
    title: document.querySelector('input[name="title"]').value,
    testType: document.querySelector('select[name="testType"]').value,
    language: document.querySelector('select[name="language"]').value,
    durationMinutes: document.querySelector('input[name="durationMinutes"]').value,
    topic: document.getElementById("aiTopic").value.trim(),
    difficulty: document.getElementById("aiDifficulty").value,
    questionCount: document.getElementById("aiQuestionCount").value,
    preferredFormats: document
      .getElementById("aiFormats")
      .value.split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    notes: document.getElementById("aiNotes").value.trim()
  };

  try {
    const result = await api("/api/dashboard/questions/generate", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    appendDraftQuestions(result.questions || []);
    status.textContent = `Generated ${result.questions?.length || 0} questions. Review and edit them before saving the exam.`;
    render();
  } catch (error) {
    status.textContent = `AI generation failed: ${error.message}`;
  }
});

document.getElementById("sessionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const values = Object.fromEntries(form.entries());
  const selectedExam = examById(values.examId);
  const rosterCount = Math.max(state.roster.length, 1);

  await api("/api/dashboard/sessions", {
    method: "POST",
    body: JSON.stringify({
      ...values,
      sessionName: String(values.sessionName || "").trim() || buildDefaultSessionName(selectedExam),
      studentCount: Number(values.studentCount || rosterCount)
    })
  });
  event.target.reset();
  await refresh();
});

document.getElementById("studentForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  await api("/api/dashboard/students", {
    method: "POST",
    body: JSON.stringify(Object.fromEntries(form.entries()))
  });
  event.target.reset();
  await refresh();
});

document.getElementById("studentImportForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.getElementById("studentImportStatus");
  const input = document.getElementById("studentImportFile");
  const file = input.files?.[0];

  if (!file) {
    status.textContent = "Choose a CSV file first.";
    return;
  }

  const text = await file.text();
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) {
    status.textContent = "The CSV file is empty.";
    return;
  }

  const headers = lines[0].split(",").map((item) => item.trim());
  const students = lines.slice(1).map((line) => {
    const values = line.split(",").map((item) => item.trim());
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
    return {
      studentNumber: row.studentNumber,
      fullName: row.fullName,
      email: row.email || ""
    };
  }).filter((student) => student.studentNumber && student.fullName);

  if (!students.length) {
    status.textContent = "No valid student rows were found. Use studentNumber,fullName,email.";
    return;
  }

  const result = await api("/api/dashboard/students/import", {
    method: "POST",
    body: JSON.stringify({ students })
  });

  status.textContent = `Imported ${result.importedCount} students.`;
  input.value = "";
  await refresh();
});

document.getElementById("registrationForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const values = Object.fromEntries(form.entries());
  await api("/api/dashboard/registrations", {
    method: "POST",
    body: JSON.stringify({
      ...values,
      seatLabel: String(values.seatLabel || "").trim()
    })
  });
  event.target.reset();
  await refresh();
});

document.getElementById("quickCreateExamButton").addEventListener("click", async () => {
  const titleInput = document.getElementById("quickExamTitle");
  const languageSelect = document.getElementById("quickExamLanguage");
  const rawTitle = String(titleInput.value || "").trim();
  const title = rawTitle || `${languageSelect.value} Exam ${new Date().toLocaleDateString()}`;

  setQuickOpsStatus("Creating exam template...");
  try {
    const exam = await api("/api/dashboard/exams", {
      method: "POST",
      body: JSON.stringify({
        title,
        testType: "Coding",
        language: languageSelect.value,
        durationMinutes: 90,
        questions: []
      })
    });
    titleInput.value = "";
    await refresh();
    const sessionExam = document.getElementById("sessionExamId");
    if (sessionExam) {
      sessionExam.value = exam.id;
    }
    setQuickOpsStatus(`Exam created: ${exam.title}`);
  } catch (error) {
    setQuickOpsStatus(`Could not create exam: ${error.message}`);
  }
});

document.getElementById("quickStartSessionButton").addEventListener("click", async () => {
  const exam = getPreferredExamForQuickOps();
  if (!exam) {
    setQuickOpsStatus("Create an exam first, then run quick start.");
    return;
  }

  setQuickOpsStatus("Creating and starting session...");
  try {
    const session = await api("/api/dashboard/sessions", {
      method: "POST",
      body: JSON.stringify({
        examId: exam.id,
        sessionName: buildDefaultSessionName(exam),
        studentCount: Math.max(state.roster.length, 1)
      })
    });
    await api(`/api/dashboard/sessions/${session.id}/start`, { method: "POST" });
    await refresh();
    const regSession = document.getElementById("registrationSessionId");
    if (regSession) {
      regSession.value = session.id;
    }
    setQuickOpsStatus(`Session started: ${session.sessionName}`);
  } catch (error) {
    setQuickOpsStatus(`Could not start session: ${error.message}`);
  }
});

document.getElementById("quickAssignAllButton").addEventListener("click", async () => {
  const session = getPreferredSessionForQuickOps();
  if (!session) {
    setQuickOpsStatus("Create a session first, then assign students.");
    return;
  }
  if (!state.roster.length) {
    setQuickOpsStatus("Import or add students first.");
    return;
  }

  setQuickOpsStatus("Assigning all students...");
  try {
    const assignedKeys = new Set(state.registrations.map((item) => `${item.sessionId}:${item.studentId}`));
    let createdCount = 0;
    for (const student of state.roster) {
      const key = `${session.id}:${student.id}`;
      if (assignedKeys.has(key)) {
        continue;
      }
      await api("/api/dashboard/registrations", {
        method: "POST",
        body: JSON.stringify({
          sessionId: session.id,
          studentId: student.id,
          seatLabel: ""
        })
      });
      createdCount += 1;
    }
    await refresh();
    setQuickOpsStatus(createdCount ? `Assigned ${createdCount} students to ${session.sessionName}.` : "All students were already assigned.");
  } catch (error) {
    setQuickOpsStatus(`Could not assign students: ${error.message}`);
  }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const action = button.getAttribute("data-action");
  const id = button.getAttribute("data-id");

  if (action === "view-submission") {
    await openSubmission(id);
    return;
  }

  if (action === "remove-question") {
    state.examDraftQuestions = state.examDraftQuestions.filter((question) => question.id !== id);
    render();
    return;
  }

  if (action === "revoke-registration") {
    await api(`/api/dashboard/registrations/${id}/revoke`, { method: "POST" });
    await refresh();
    return;
  }

  if (action === "reject-registration" || action === "delete-registration") {
    await api(`/api/dashboard/registrations/${id}`, { method: "DELETE" });
    await refresh();
    return;
  }

  if (action === "delete-student") {
    await api(`/api/dashboard/students/${id}`, { method: "DELETE" });
    await refresh();
    return;
  }

  if (action === "delete-session") {
    await api(`/api/dashboard/sessions/${id}`, { method: "DELETE" });
    await refresh();
    return;
  }

  if (action === "delete-exam") {
    await api(`/api/dashboard/exams/${id}`, { method: "DELETE" });
    await refresh();
    return;
  }

  await api(`/api/dashboard/sessions/${id}/${action}`, { method: "POST" });
  await refresh();
});

document.getElementById("submissionFileSelect").addEventListener("change", (event) => {
  state.selectedSubmissionFile = event.target.value;
  renderSubmissionInspector();
});

document.getElementById("closeInspector").addEventListener("click", () => {
  state.selectedSubmission = null;
  state.selectedSubmissionFile = "";
  state.gradeSaveState = "No grade saved yet.";
  renderSubmissionInspector();
});

document.getElementById("gradingForm").addEventListener("submit", saveGrade);

document.querySelectorAll("[data-scroll-target]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = document.getElementById(button.getAttribute("data-scroll-target"));
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

const socket = new WebSocket(`${window.location.origin.replace("http", "ws")}/ws`);
socket.onopen = () => {
  state.socketState = "Connected";
  render();
};
socket.onmessage = async () => {
  await refresh();
};
socket.onerror = () => {
  state.socketState = "Error";
  render();
};
socket.onclose = () => {
  state.socketState = "Disconnected";
  render();
};

refresh().catch(console.error);
