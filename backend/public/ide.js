(async () => {
  const state = {
    config: null,
    auth: {
      sessionId: "open-session",
      studentId: "open-student",
      studentName: "Open Student",
      examId: "open-exam"
    },
    runtimeLanguage: "Python",
    files: {},
    activeFile: "main.py",
    saveTimer: null,
    exam: null,
    currentQuestionIndex: -1,
    questionStates: []
  };

  const editor = document.getElementById("editor");
  const stdinEditor = document.getElementById("stdinEditor");
  const fileList = document.getElementById("fileList");
  const consoleOutput = document.getElementById("consoleOutput");
  const saveState = document.getElementById("saveState");
  const studentLabel = document.getElementById("studentLabel");
  const timerLabel = document.getElementById("timerLabel");
  const examLabel = document.getElementById("examLabel");
  const ideTitle = document.getElementById("ideTitle");
  const activeFileName = document.getElementById("activeFileName");
  const questionList = document.getElementById("questionList");
  const questionStageLabel = document.getElementById("questionStageLabel");
  const questionProgressLabel = document.getElementById("questionProgressLabel");
  const questionStatusList = document.getElementById("questionStatusList");
  const flagQuestionButton = document.getElementById("flagQuestionButton");
  const markAnsweredButton = document.getElementById("markAnsweredButton");
  const prevQuestionButton = document.getElementById("prevQuestionButton");
  const nextQuestionButton = document.getElementById("nextQuestionButton");
  const submissionReviewModal = document.getElementById("submissionReviewModal");
  const submissionReviewSummary = document.getElementById("submissionReviewSummary");
  const submissionReviewList = document.getElementById("submissionReviewList");
  const closeReviewModal = document.getElementById("closeReviewModal");
  const confirmFinalSubmitButton = document.getElementById("confirmFinalSubmitButton");
  const runButton = document.getElementById("runButton");
  const addFileButton = document.getElementById("addFileButton");
  const renameFileButton = document.getElementById("renameFileButton");
  const urlParams = new URLSearchParams(window.location.search);
  const requestedLanguageFromUrl = urlParams.get("language") || "";
  let remainingSeconds = null;
  let timerInterval = null;
  let timerExpired = false;

  function authPayload() {
    return {
      sessionId: state.auth.sessionId,
      studentId: state.auth.studentId,
      examId: state.auth.examId,
      studentName: state.auth.studentName
    };
  }

  function setSaveState(text) {
    saveState.textContent = text;
  }

  function normalizeLanguage(language = "") {
    const value = String(language || "").trim().toLowerCase();
    if (value.includes("rust") || value.includes("rush") || value === "rs") {
      return "Rust";
    }
    return "Python";
  }

  function chooseActiveFile(files = {}, language = "Python") {
    const names = Object.keys(files);
    if (!names.length) {
      return normalizeLanguage(language) === "Rust" ? "src/main.rs" : "main.py";
    }

    if (normalizeLanguage(language) === "Rust") {
      if (names.includes("src/main.rs")) {
        return "src/main.rs";
      }
      if (names.includes("main.rs")) {
        return "main.rs";
      }
    }

    if (names.includes("main.py")) {
      return "main.py";
    }

    return names[0];
  }

  function setRuntimeLanguage(language) {
    state.runtimeLanguage = normalizeLanguage(language);
    ideTitle.textContent = `${state.runtimeLanguage} IDE`;
    runButton.textContent = state.runtimeLanguage === "Rust" ? "Compile and Run Rust" : "Run Python";
  }

  function isInvalidFilename(filename) {
    return (
      !filename ||
      filename.includes("..") ||
      filename.startsWith("/") ||
      filename.startsWith("\\") ||
      /^[a-zA-Z]:\\/.test(filename)
    );
  }

  function isAllowedLanguageFile(filename) {
    const lower = String(filename || "").toLowerCase();
    if (state.runtimeLanguage === "Rust") {
      return lower.endsWith(".rs");
    }
    return lower.endsWith(".py");
  }

  function languageMainFile() {
    return state.runtimeLanguage === "Rust" ? "src/main.rs" : "main.py";
  }

  function defaultMainContent() {
    if (state.runtimeLanguage === "Rust") {
      return "fn main() {\n    // TODO\n}\n";
    }
    return "def main():\n    pass\n\n\nif __name__ == \"__main__\":\n    main()\n";
  }

  function sanitizeFilesForLanguage(files = {}) {
    const source = { ...(files || {}) };
    const filteredEntries = Object.entries(source).filter(([name]) => isAllowedLanguageFile(name));
    const sanitized = Object.fromEntries(filteredEntries);
    const mainFile = languageMainFile();
    if (!sanitized[mainFile]) {
      sanitized[mainFile] = defaultMainContent();
    }
    return sanitized;
  }

  function starterForFilename(filename) {
    const lower = filename.toLowerCase();
    if (lower.endsWith(".py")) {
      return "def helper():\n    pass\n";
    }
    if (lower.endsWith(".rs")) {
      return "pub fn helper() {\n    // TODO\n}\n";
    }
    if (lower.endsWith(".md")) {
      return "# Notes\n";
    }
    if (lower.endsWith(".txt")) {
      return "";
    }
    return "";
  }

  function formatRemaining(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function renderTimer() {
    if (remainingSeconds == null) {
      timerLabel.textContent = "Exam timer loading...";
      return;
    }

    timerLabel.textContent = `Time remaining: ${formatRemaining(Math.max(0, remainingSeconds))}`;
  }

  function ensureQuestionStates(exam) {
    const questions = Array.isArray(exam?.questions) ? exam.questions : [];
    state.questionStates = questions.map((question, index) => ({
      id: question.id || `question-${index + 1}`,
      flagged: state.questionStates[index]?.id === (question.id || `question-${index + 1}`) ? state.questionStates[index].flagged : false,
      answered: state.questionStates[index]?.id === (question.id || `question-${index + 1}`) ? state.questionStates[index].answered : false,
      visited: state.questionStates[index]?.id === (question.id || `question-${index + 1}`) ? state.questionStates[index].visited : false
    }));
  }

  function currentQuestionState() {
    if (state.currentQuestionIndex < 0) {
      return null;
    }
    return state.questionStates[state.currentQuestionIndex] || null;
  }

  function renderQuestionStatusList() {
    if (!state.exam?.questions?.length) {
      questionStatusList.innerHTML = `<p class="muted">No question status available.</p>`;
      return;
    }

    questionStatusList.innerHTML = state.exam.questions
      .map((question, index) => {
        const status = state.questionStates[index] || {};
        const chips = [
          status.answered ? "Answered" : "Unanswered",
          status.flagged ? "Flagged" : "",
          status.visited ? "Visited" : "Not opened"
        ].filter(Boolean).join(" | ");

        return `
          <button class="question-status-item ${index === state.currentQuestionIndex ? "active" : ""}" data-jump-question="${index}" type="button">
            <strong>Q${index + 1}</strong>
            <span>${question.title}</span>
            <small>${chips}</small>
          </button>
        `;
      })
      .join("");
  }

  function renderSubmissionReview() {
    if (!state.exam?.questions?.length) {
      submissionReviewSummary.innerHTML = `<p class="muted">No saved exam paper is available for review.</p>`;
      submissionReviewList.innerHTML = "";
      return;
    }

    const unanswered = [];
    const flagged = [];

    const items = state.exam.questions.map((question, index) => {
      const status = state.questionStates[index] || {};
      if (!status.answered) {
        unanswered.push(index + 1);
      }
      if (status.flagged) {
        flagged.push(index + 1);
      }

      return `
        <article class="review-item">
          <strong>Question ${index + 1}: ${question.title}</strong>
          <div class="muted">${status.answered ? "Answered" : "Not answered yet"} | ${status.flagged ? "Flagged for review" : "Not flagged"}</div>
        </article>
      `;
    }).join("");

    submissionReviewSummary.innerHTML = `
      <div class="review-metrics">
        <div><strong>${state.exam.questions.length}</strong><span>Total Questions</span></div>
        <div><strong>${unanswered.length}</strong><span>Unanswered</span></div>
        <div><strong>${flagged.length}</strong><span>Flagged</span></div>
      </div>
      <p class="muted">${unanswered.length ? `Unanswered: Q${unanswered.join(", Q")}.` : "All questions are marked answered."} ${flagged.length ? `Flagged: Q${flagged.join(", Q")}.` : "No questions are currently flagged."}</p>
    `;
    submissionReviewList.innerHTML = items;
  }

  function renderQuestions(exam) {
    state.exam = exam;
    setRuntimeLanguage(exam?.language || state.runtimeLanguage);
    ensureQuestionStates(exam);

    if (!exam) {
      examLabel.textContent = "No saved exam paper found for this session.";
      questionStageLabel.textContent = "Instructions";
      questionProgressLabel.textContent = "No exam paper attached";
      flagQuestionButton.disabled = true;
      markAnsweredButton.disabled = true;
      prevQuestionButton.disabled = true;
      nextQuestionButton.disabled = true;
      questionList.innerHTML = `<p class="muted">The teacher has not attached any questions to this exam yet.</p>`;
      renderQuestionStatusList();
      return;
    }

    examLabel.textContent = `${exam.title} | ${exam.testType} | ${exam.durationMinutes} min`;
    const questions = Array.isArray(exam.questions) ? exam.questions : [];

    if (!questions.length) {
      questionStageLabel.textContent = "Instructions";
      questionProgressLabel.textContent = "No saved questions";
      flagQuestionButton.disabled = true;
      markAnsweredButton.disabled = true;
      prevQuestionButton.disabled = true;
      nextQuestionButton.disabled = true;
      questionList.innerHTML = `<p class="muted">This exam has no saved questions yet. You can still use the IDE if your teacher is running a practice session.</p>`;
      renderQuestionStatusList();
      return;
    }

    if (state.currentQuestionIndex < -1 || state.currentQuestionIndex >= questions.length) {
      state.currentQuestionIndex = -1;
    }

    if (state.currentQuestionIndex === -1) {
      questionStageLabel.textContent = "Instructions";
      questionProgressLabel.textContent = `${questions.length} questions total`;
      flagQuestionButton.disabled = true;
      markAnsweredButton.disabled = true;
      prevQuestionButton.disabled = true;
      nextQuestionButton.disabled = false;
      nextQuestionButton.textContent = "Start Question 1";
      questionList.innerHTML = `
        <article class="question-card instruction-card">
          <strong>Before you start</strong>
          <div class="instruction-list">
            <div>Read each question carefully before writing code.</div>
            <div>Use the file panel to switch between files and save drafts often.</div>
            <div>Use the run button to test your code before submitting.</div>
            <div>When you finish the paper, click Submit and Exit.</div>
            <div>You can move between questions using Previous and Next.</div>
          </div>
        </article>
      `;
      renderQuestionStatusList();
      return;
    }

    const question = questions[state.currentQuestionIndex];
    const status = currentQuestionState();
    if (status) {
      status.visited = true;
    }
    const options = question.options?.length
      ? `<div class="question-options">${question.options
          .map((option) => `<div class="question-option">${option}</div>`)
          .join("")}</div>`
      : "";

    const starter = question.starter
      ? `<pre class="question-snippet">${question.starter}</pre>`
      : "";

    questionStageLabel.textContent = `Question ${state.currentQuestionIndex + 1}`;
    questionProgressLabel.textContent = `${state.currentQuestionIndex + 1} of ${questions.length}`;
    flagQuestionButton.disabled = false;
    flagQuestionButton.textContent = status?.flagged ? "Unflag" : "Flag";
    markAnsweredButton.disabled = false;
    markAnsweredButton.textContent = status?.answered ? "Marked Answered" : "Mark Answered";
    prevQuestionButton.disabled = state.currentQuestionIndex === -1;
    nextQuestionButton.disabled = false;
    nextQuestionButton.textContent =
      state.currentQuestionIndex >= questions.length - 1 ? "Review Before Submit" : "Next";

    questionList.innerHTML = `
      <article class="question-card">
        <div class="question-meta-row">
          <strong>${question.title}</strong>
          <span class="status-chip">${question.format} | ${question.points} pts | ${status?.flagged ? "Flagged" : status?.answered ? "Answered" : "Open"}</span>
        </div>
        ${question.section ? `<div class="muted">${question.section}</div>` : ""}
        <p class="question-prompt">${question.prompt}</p>
        ${options}
        ${starter}
      </article>
    `;
    renderQuestionStatusList();
  }

  function goToPreviousQuestion() {
    if (!state.exam?.questions?.length) {
      return;
    }

    state.currentQuestionIndex = Math.max(-1, state.currentQuestionIndex - 1);
    renderQuestions(state.exam);
  }

  function goToNextQuestion() {
    if (!state.exam?.questions?.length) {
      return;
    }

    if (state.currentQuestionIndex >= state.exam.questions.length - 1) {
      renderSubmissionReview();
      submissionReviewModal.classList.remove("hidden");
      return;
    }

    state.currentQuestionIndex += 1;
    renderQuestions(state.exam);
  }

  function toggleFlag() {
    const status = currentQuestionState();
    if (!status) {
      return;
    }
    status.flagged = !status.flagged;
    renderQuestions(state.exam);
  }

  function toggleAnswered() {
    const status = currentQuestionState();
    if (!status) {
      return;
    }
    status.answered = !status.answered;
    renderQuestions(state.exam);
  }

  async function autoSubmitOnTimeout() {
    if (timerExpired) {
      return;
    }

    timerExpired = true;
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    try {
      await saveWorkspace();
      await api("/api/exam/submit", {
        method: "POST",
        body: JSON.stringify({
          ...authPayload(),
          language: state.runtimeLanguage,
          files: state.files
        })
      });
    } catch (error) {}

    await window.secureClient?.submitExam({ reason: "timer-expired" });
  }

  async function loadTimer() {
    const query = new URLSearchParams(authPayload()).toString();
    const timer = await api(`/api/exam/timer?${query}`);
    remainingSeconds = Number(timer.remainingSeconds || 0);
    renderTimer();

    if (timerInterval) {
      clearInterval(timerInterval);
    }

    timerInterval = setInterval(() => {
      remainingSeconds -= 1;
      renderTimer();

      if (remainingSeconds <= 0) {
        timerLabel.textContent = "Time remaining: 00:00";
        autoSubmitOnTimeout().catch(() => {});
      }
    }, 1000);
  }

  async function getConfig() {
    if (window.secureClient?.getConfig) {
      return window.secureClient.getConfig();
    }

    return {
      backendUrl: window.location.origin,
      secureSessionToken: "SECURE_SESSION_TOKEN"
    };
  }

  async function detectLanguageFromLobbySession() {
    try {
      const response = await fetch(`${state.config.backendUrl}/api/exam/lobby/session`);
      if (!response.ok) {
        return;
      }
      const session = await response.json();
      if (session?.language) {
        setRuntimeLanguage(session.language);
      }
    } catch (_error) {}
  }

  async function api(path, options = {}) {
    const response = await fetch(`${state.config.backendUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    return response.json();
  }

  function persistActiveFile() {
    if (state.activeFile && Object.prototype.hasOwnProperty.call(state.files, state.activeFile)) {
      state.files[state.activeFile] = editor.value;
    }
  }

  function renderFiles() {
    fileList.innerHTML = "";

    Object.keys(state.files)
      .filter((filename) => isAllowedLanguageFile(filename))
      .forEach((filename) => {
      const button = document.createElement("button");
      button.className = `file-item ${filename === state.activeFile ? "active" : ""}`;
      button.textContent = filename;
      button.addEventListener("click", () => {
        persistActiveFile();
        state.activeFile = filename;
        activeFileName.textContent = filename;
        editor.value = state.files[filename];
        renderFiles();
      });
        fileList.appendChild(button);
      });
  }

  async function saveWorkspace() {
    persistActiveFile();
    state.files = sanitizeFilesForLanguage(state.files);
    setSaveState("Saving");
    await api("/api/exam/workspace", {
      method: "POST",
      body: JSON.stringify({
        ...authPayload(),
        language: state.runtimeLanguage,
        files: state.files
      })
    });
    setSaveState("Saved");
  }

  async function runCode() {
    await saveWorkspace();
    consoleOutput.textContent = state.runtimeLanguage === "Rust" ? "Compiling and running Rust..." : "Running Python...";

    const result = await api("/api/exam/run", {
      method: "POST",
      body: JSON.stringify({
        ...authPayload(),
        language: state.runtimeLanguage,
        files: state.files,
        stdin: stdinEditor.value
      })
    });

    consoleOutput.textContent = [
      result.command ? `$ ${result.command}` : "",
      result.stdout || "",
      result.stderr || ""
    ].filter(Boolean).join("\n");
  }

  async function submitExam() {
    await saveWorkspace();
    await api("/api/exam/submit", {
      method: "POST",
      body: JSON.stringify({
        ...authPayload(),
        language: state.runtimeLanguage,
        files: state.files
      })
    });

    await window.secureClient?.submitExam({ reason: "submitted-from-ide" });
  }

  async function exitExam() {
    await saveWorkspace();
    await window.secureClient?.exitExam({ reason: "ide-exit" });
  }

  async function loadWorkspace() {
    const query = new URLSearchParams({
      ...authPayload(),
      language: state.runtimeLanguage
    }).toString();
    const workspace = await api(`/api/exam/workspace?${query}`);
    state.files = workspace.files;
    setRuntimeLanguage(workspace.exam?.language || requestedLanguageFromUrl || state.runtimeLanguage);
    state.files = sanitizeFilesForLanguage(state.files);
    state.activeFile = chooseActiveFile(state.files, state.runtimeLanguage);
    editor.value = state.files[state.activeFile];
    stdinEditor.value = "";
    activeFileName.textContent = state.activeFile;
    renderQuestions(workspace.exam);
    renderFiles();
    await saveWorkspace();
    setSaveState("Ready");
  }

  async function addFile() {
    const suggestion = state.runtimeLanguage === "Rust" ? "src/utils.rs" : "utils.py";
    const filename = window.prompt("New file name (you can include folders):", suggestion);
    if (filename == null) {
      return;
    }

    const trimmed = String(filename).trim();
    if (isInvalidFilename(trimmed)) {
      consoleOutput.textContent = "Invalid file name. Use a relative path like utils.py or src/utils.rs.";
      return;
    }

    if (!isAllowedLanguageFile(trimmed)) {
      consoleOutput.textContent =
        state.runtimeLanguage === "Rust"
          ? "Rust exam mode only allows .rs files."
          : "Python exam mode only allows .py files.";
      return;
    }

    if (state.files[trimmed] != null) {
      consoleOutput.textContent = `File already exists: ${trimmed}`;
      return;
    }

    persistActiveFile();
    state.files[trimmed] = starterForFilename(trimmed);
    state.activeFile = trimmed;
    activeFileName.textContent = trimmed;
    editor.value = state.files[trimmed];
    renderFiles();
    await saveWorkspace();
  }

  async function renameActiveFile() {
    if (!state.activeFile || !Object.prototype.hasOwnProperty.call(state.files, state.activeFile)) {
      consoleOutput.textContent = "Select a file first.";
      return;
    }

    const nextNameRaw = window.prompt("Rename file to:", state.activeFile);
    if (nextNameRaw == null) {
      return;
    }

    const nextName = String(nextNameRaw).trim();
    if (!nextName || nextName === state.activeFile) {
      return;
    }

    if (isInvalidFilename(nextName)) {
      consoleOutput.textContent = "Invalid file name. Use a relative path like utils.py or src/utils.rs.";
      return;
    }

    if (!isAllowedLanguageFile(nextName)) {
      consoleOutput.textContent =
        state.runtimeLanguage === "Rust"
          ? "Rust exam mode only allows .rs files."
          : "Python exam mode only allows .py files.";
      return;
    }

    if (state.files[nextName] != null) {
      consoleOutput.textContent = `File already exists: ${nextName}`;
      return;
    }

    const mainFile = languageMainFile();
    if (state.activeFile === mainFile) {
      consoleOutput.textContent = `Main file must stay as ${mainFile}. Add extra module files instead.`;
      return;
    }

    const content = state.files[state.activeFile];
    delete state.files[state.activeFile];
    state.files[nextName] = content;
    state.activeFile = nextName;
    activeFileName.textContent = nextName;
    editor.value = state.files[nextName];
    renderFiles();
    await saveWorkspace();
  }

  editor.addEventListener("input", () => {
    persistActiveFile();
    setSaveState("Unsaved");
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
      saveWorkspace().catch(() => setSaveState("Save failed"));
    }, 900);
  });

  stdinEditor.addEventListener("input", () => {
    persistActiveFile();
  });

  document.getElementById("runButton").addEventListener("click", () => {
    runCode().catch((error) => {
      consoleOutput.textContent = error.message;
    });
  });

  addFileButton.addEventListener("click", () => {
    addFile().catch((error) => {
      consoleOutput.textContent = error.message;
    });
  });

  renameFileButton.addEventListener("click", () => {
    renameActiveFile().catch((error) => {
      consoleOutput.textContent = error.message;
    });
  });

  document.getElementById("saveButton").addEventListener("click", () => {
    saveWorkspace().catch(() => setSaveState("Save failed"));
  });

  document.getElementById("submitButton").addEventListener("click", () => {
    renderSubmissionReview();
    submissionReviewModal.classList.remove("hidden");
  });

  confirmFinalSubmitButton.addEventListener("click", () => {
    submitExam().catch((error) => {
      consoleOutput.textContent = error.message;
    });
  });

  document.getElementById("exitButton").addEventListener("click", () => {
    exitExam().catch((error) => {
      consoleOutput.textContent = error.message;
    });
  });

  flagQuestionButton.addEventListener("click", toggleFlag);
  markAnsweredButton.addEventListener("click", toggleAnswered);
  prevQuestionButton.addEventListener("click", goToPreviousQuestion);
  nextQuestionButton.addEventListener("click", goToNextQuestion);
  closeReviewModal.addEventListener("click", () => submissionReviewModal.classList.add("hidden"));
  submissionReviewModal.addEventListener("click", (event) => {
    if (event.target === submissionReviewModal) {
      submissionReviewModal.classList.add("hidden");
    }
  });
  questionStatusList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-jump-question]");
    if (!button) {
      return;
    }
    state.currentQuestionIndex = Number(button.getAttribute("data-jump-question"));
    renderQuestions(state.exam);
  });

  setRuntimeLanguage(requestedLanguageFromUrl || state.runtimeLanguage);
  state.config = await getConfig();
  state.auth = {
    sessionId: state.config.session?.id || state.auth.sessionId,
    studentId: state.config.student?.id || state.auth.studentId,
    studentName: state.config.student?.name || state.auth.studentName,
    examId: state.config.exam?.id || state.auth.examId
  };
  if (!requestedLanguageFromUrl && state.auth.examId === "open-exam") {
    await detectLanguageFromLobbySession();
  }
  studentLabel.textContent = `${state.auth.studentName} | ${state.config.student?.studentNumber || ""}`.trim();
  await loadWorkspace();
  await loadTimer();
  await window.secureClient?.setLockdown(true);
})();
