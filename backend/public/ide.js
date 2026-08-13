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
    questionStates: [],
    questionDirty: false,
    answerText: "",
    selectedOption: ""
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
  const workspacePurpose = document.getElementById("workspacePurpose");
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
  const filesPanel = document.getElementById("filesPanel");
  const codingWorkspace = document.getElementById("codingWorkspace");
  const textAnswerPanel = document.getElementById("textAnswerPanel");
  const textAnswerEditor = document.getElementById("textAnswerEditor");
  const multipleChoiceOptions = document.getElementById("multipleChoiceOptions");
  const answerPanelTitle = document.getElementById("answerPanelTitle");
  const answerPanelHint = document.getElementById("answerPanelHint");
  const textAnswerCount = document.getElementById("textAnswerCount");
  const previewPanel = document.getElementById("previewPanel");
  const htmlPreview = document.getElementById("htmlPreview");
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
    if (value.includes("html") || value.includes("frontend") || value === "web") {
      return "HTML";
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

    if (normalizeLanguage(language) === "HTML" && names.includes("index.html")) {
      return "index.html";
    }

    if (names.includes("main.py")) {
      return "main.py";
    }

    return names[0];
  }

  function setRuntimeLanguage(language) {
    state.runtimeLanguage = normalizeLanguage(language);
    ideTitle.textContent = `${state.runtimeLanguage} IDE`;
    runButton.textContent = state.runtimeLanguage === "HTML" ? "Refresh Preview" : `Run ${state.runtimeLanguage}`;
    previewPanel.classList.toggle("hidden", state.runtimeLanguage !== "HTML");
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
    if (state.runtimeLanguage === "HTML") {
      return /\.(html|css|js)$/.test(lower);
    }
    return lower.endsWith(".py");
  }

  function languageMainFile() {
    if (state.runtimeLanguage === "Rust") return "src/main.rs";
    if (state.runtimeLanguage === "HTML") return "index.html";
    return "main.py";
  }

  function defaultMainContent() {
    return "";
  }

  function outputText(result) {
    const stdout = String(result?.stdout || "").trimEnd();
    return stdout || "No output.";
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

  function buildHtmlPreview(files = {}) {
    let documentHtml = files["index.html"] || defaultMainContent();
    Object.entries(files).forEach(([filename, content]) => {
      if (filename.toLowerCase().endsWith(".css")) {
        const escapedName = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const linkPattern = new RegExp(`<link[^>]+href=["']${escapedName}["'][^>]*>`, "gi");
        documentHtml = linkPattern.test(documentHtml)
          ? documentHtml.replace(linkPattern, `<style data-file="${filename}">${content}</style>`)
          : documentHtml.replace("</head>", `<style data-file="${filename}">${content}</style></head>`);
      }
      if (filename.toLowerCase().endsWith(".js")) {
        const escapedName = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const scriptPattern = new RegExp(`<script[^>]+src=["']${escapedName}["'][^>]*>\\s*</script>`, "gi");
        documentHtml = scriptPattern.test(documentHtml)
          ? documentHtml.replace(scriptPattern, `<script data-file="${filename}">${content}<\/script>`)
          : documentHtml.replace("</body>", `<script data-file="${filename}">${content}<\/script></body>`);
      }
    });
    return documentHtml;
  }

  function starterForFilename(filename) {
    const lower = filename.toLowerCase();
    if (lower.endsWith(".py")) {
      return "def helper():\n    pass\n";
    }
    if (lower.endsWith(".rs")) {
      return "pub fn helper() {\n    // TODO\n}\n";
    }
    if (lower.endsWith(".html")) return "<section>\n  <!-- TODO -->\n</section>\n";
    if (lower.endsWith(".css")) return ":root {\n  color-scheme: light;\n}\n";
    if (lower.endsWith(".js")) return "// Add your browser logic here.\n";
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

  function currentQuestion() {
    return state.currentQuestionIndex >= 0 ? state.exam?.questions?.[state.currentQuestionIndex] || null : null;
  }

  function currentQuestionId() {
    return currentQuestion()?.id || "";
  }

  function syncCurrentAnsweredState() {
    const status = currentQuestionState();
    if (!status) return;
    if (isCodingQuestion()) {
      persistActiveFile();
      status.answered = Object.values(state.files || {}).some((content) => String(content).trim());
    } else {
      status.answered = Boolean(String(state.answerText || "").trim() || String(state.selectedOption || "") !== "");
    }
    renderQuestionStatusList();
  }

  function isCodingQuestion(question = currentQuestion()) {
    const format = String(question?.format || "Coding").toLowerCase();
    return format.includes("coding") || format.includes("debug") || format.includes("frontend");
  }

  function isMultipleChoiceQuestion(question = currentQuestion()) {
    return String(question?.format || "").toLowerCase().includes("multiple");
  }

  function renderAnswerMode(question, answer) {
    const coding = isCodingQuestion(question);
    filesPanel.classList.remove("hidden");
    codingWorkspace.classList.remove("hidden");
    textAnswerPanel.classList.toggle("hidden", coding);
    runButton.classList.remove("hidden");
    addFileButton.classList.remove("hidden");
    renameFileButton.classList.remove("hidden");
    workspacePurpose.textContent = coding ? "Official coding answer" : "Practice IDE - not part of your written answer";
    codingWorkspace.classList.toggle("scratch-workspace", !coding);
    if (coding) return;

    state.answerText = answer?.answerText || "";
    state.selectedOption = answer?.selectedOption || "";
    const multipleChoice = isMultipleChoiceQuestion(question);
    multipleChoiceOptions.classList.toggle("hidden", !multipleChoice);
    textAnswerEditor.classList.toggle("hidden", multipleChoice);
    answerPanelTitle.textContent = multipleChoice ? "Choose One Answer" : question.format || "Written Answer";
    answerPanelHint.textContent = multipleChoice
      ? "Select the best answer here. The practice IDE below is separate."
      : "Enter your official written answer here. Code in the practice IDE below is not submitted as this answer.";
    textAnswerEditor.value = state.answerText;
    textAnswerEditor.rows = String(question?.format || "").toLowerCase().includes("long") ? 16 : 6;
    multipleChoiceOptions.innerHTML = multipleChoice ? (question.options || []).map((option, index) => `<label class="choice-option"><input type="radio" name="questionChoice" value="${index}" ${state.selectedOption === String(index) ? "checked" : ""}><span><strong>${String.fromCharCode(65 + index)}</strong>${option}</span></label>`).join("") : "";
    textAnswerCount.textContent = multipleChoice ? (state.selectedOption ? "Selected" : "Not selected") : `${state.answerText.trim() ? state.answerText.trim().split(/\s+/).length : 0} words`;
  }

  function renderInstructionsMode() {
    filesPanel.classList.add("hidden");
    codingWorkspace.classList.add("hidden");
    textAnswerPanel.classList.add("hidden");
    runButton.classList.add("hidden");
    addFileButton.classList.add("hidden");
    renameFileButton.classList.add("hidden");
  }

  function starterFilesForQuestion(question) {
    const mainFile = languageMainFile();
    const starter = String(question?.starter || "").trim();
    if (starter) {
      return { [mainFile]: `${starter}\n` };
    }
    return { [mainFile]: defaultMainContent() };
  }

  async function openQuestion(index) {
    if (!state.exam?.questions?.[index]) return;
    if (state.currentQuestionIndex >= 0 && state.questionDirty) {
      await saveWorkspace("AUTOSAVE");
    }

    state.currentQuestionIndex = index;
    const question = currentQuestion();
    const query = new URLSearchParams({
      ...authPayload(),
      language: state.runtimeLanguage,
      questionId: question.id
    }).toString();
    const workspace = await api(`/api/exam/workspace?${query}`);
    state.files = isCodingQuestion(question)
      ? workspace.questionAnswer?.files || starterFilesForQuestion(question)
      : workspace.questionAnswer?.scratchFiles || workspace.files || starterFilesForQuestion(question);
    const questionState = currentQuestionState();
    if (workspace.questionAnswer && questionState) {
      questionState.answered = isCodingQuestion(question)
        ? Object.values(workspace.questionAnswer.files || {}).some((content) => String(content).trim())
        : Boolean(String(workspace.questionAnswer.answerText || "").trim() || String(workspace.questionAnswer.selectedOption || "") !== "");
    }
    state.files = sanitizeFilesForLanguage(state.files);
    state.activeFile = chooseActiveFile(state.files, state.runtimeLanguage);
    editor.value = state.files[state.activeFile];
    stdinEditor.value = isCodingQuestion(question) ? workspace.questionAnswer?.stdinText || "" : workspace.questionAnswer?.scratchStdinText || "";
    renderAnswerMode(question, workspace.questionAnswer);
    activeFileName.textContent = state.activeFile;
    const latestResult = isCodingQuestion(question) ? workspace.questionAnswer?.result : workspace.questionAnswer?.scratchResult;
    consoleOutput.textContent = latestResult ? outputText(latestResult) : "No output yet.";
    state.questionDirty = false;
    renderFiles();
    renderQuestions(state.exam);
  }

  function renderQuestionStatusList() {
    if (!state.exam?.questions?.length) {
      questionStatusList.innerHTML = `<p class="muted">No question status available.</p>`;
      return;
    }

    const total = state.exam.questions.length;
    const answered = state.questionStates.filter((status) => status?.answered).length;
    const flagged = state.questionStates.filter((status) => status?.flagged).length;
    const progress = total ? Math.round(answered / total * 100) : 0;
    const tiles = state.exam.questions
      .map((question, index) => {
        const status = state.questionStates[index] || {};
        const stateClass = status.flagged ? "flagged" : status.answered ? "answered" : status.visited ? "visited" : "unanswered";
        const stateLabel = status.flagged ? "Flagged" : status.answered ? "Answered" : status.visited ? "Visited, unanswered" : "Not opened";

        return `
          <button class="question-map-tile ${stateClass} ${index === state.currentQuestionIndex ? "active" : ""}" data-jump-question="${index}" type="button" title="Question ${index + 1}: ${stateLabel}" aria-label="Open Question ${index + 1}, ${stateLabel}">
            <strong>${index + 1}</strong>${status.flagged ? '<span aria-hidden="true">!</span>' : status.answered ? '<span aria-hidden="true">✓</span>' : ""}
          </button>
        `;
      })
      .join("");
    questionStatusList.innerHTML = `
      <div class="question-map-summary">
        <div class="progress-ring" style="--progress:${progress * 3.6}deg"><strong>${answered}/${total}</strong><span>answered</span></div>
        <div class="map-counts"><span><b>${total - answered}</b> left</span><span><b>${flagged}</b> flagged</span></div>
      </div>
      <div class="question-map-grid">${tiles}</div>
      <div class="question-map-legend"><span class="answered">Answered</span><span class="flagged">Flagged</span><span class="current">Current</span></div>
    `;
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

      const stateClass = status.flagged ? "flagged" : status.answered ? "answered" : "unanswered";
      return `<button class="review-question-tile ${stateClass}" data-review-question="${index}" type="button"><strong>Q${index + 1}</strong><span>${status.flagged ? "Flagged" : status.answered ? "Answered" : "Unanswered"}</span></button>`;
    }).join("");

    submissionReviewSummary.innerHTML = `
      <div class="review-metrics">
        <div><strong>${state.exam.questions.length}</strong><span>Total Questions</span></div>
        <div><strong>${unanswered.length}</strong><span>Unanswered</span></div>
        <div><strong>${flagged.length}</strong><span>Flagged</span></div>
      </div>
      <p class="muted">Select a question tile below to review it before submitting.</p>
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
      renderInstructionsMode();
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

  async function goToPreviousQuestion() {
    if (!state.exam?.questions?.length) {
      return;
    }

    if (state.currentQuestionIndex <= 0) {
      if (state.questionDirty) await saveWorkspace("AUTOSAVE");
      state.currentQuestionIndex = -1;
      renderQuestions(state.exam);
      return;
    }
    await openQuestion(state.currentQuestionIndex - 1);
  }

  async function goToNextQuestion() {
    if (!state.exam?.questions?.length) {
      return;
    }

    if (state.currentQuestionIndex >= state.exam.questions.length - 1) {
      const status = currentQuestionState();
      if (status) status.answered = true;
      state.questionDirty = true;
      if (state.questionDirty) await saveWorkspace("AUTOSAVE");
      renderSubmissionReview();
      submissionReviewModal.classList.remove("hidden");
      return;
    }

    if (state.currentQuestionIndex >= 0) {
      const status = currentQuestionState();
      if (status) status.answered = true;
      state.questionDirty = true;
    }
    await openQuestion(state.currentQuestionIndex + 1);
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
    state.questionDirty = true;
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
      await saveWorkspace("TIMER_SUBMIT");
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

  async function saveWorkspace(recordType = "AUTOSAVE") {
    persistActiveFile();
    state.files = sanitizeFilesForLanguage(state.files);
    setSaveState("Saving");
    const workspace = await api("/api/exam/workspace", {
      method: "POST",
      body: JSON.stringify({
        ...authPayload(),
        language: state.runtimeLanguage,
        files: state.files,
        activeFile: state.activeFile,
        questionId: currentQuestionId(),
        stdin: stdinEditor.value,
        answerText: state.answerText,
        selectedOption: state.selectedOption,
        answerMode: isCodingQuestion() ? "coding" : "text",
        recordType
      })
    });
    const version = workspace.recording?.versionNumber;
    setSaveState(version ? `Synced v${version}` : "Synced");
    state.questionDirty = false;
  }

  async function runCode() {
    await saveWorkspace("BEFORE_RUN");
    consoleOutput.textContent = "Running...";

    const result = await api("/api/exam/run", {
      method: "POST",
      body: JSON.stringify({
        ...authPayload(),
        language: state.runtimeLanguage,
        files: state.files,
        activeFile: state.activeFile,
        questionId: currentQuestionId(),
        stdin: stdinEditor.value,
        answerText: state.answerText,
        selectedOption: state.selectedOption,
        answerMode: isCodingQuestion() ? "coding" : "text"
      })
    });

    consoleOutput.textContent = outputText(result);

    if (state.runtimeLanguage === "HTML") {
      htmlPreview.srcdoc = buildHtmlPreview(state.files);
    }
  }

  async function submitExam() {
    await saveWorkspace("BEFORE_SUBMIT");
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
    await saveWorkspace("EXIT_SAVE");
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
    if (state.runtimeLanguage === "HTML") {
      htmlPreview.srcdoc = buildHtmlPreview(state.files);
    }
    await saveWorkspace("AUTOSAVE");
    setSaveState("Ready");
  }

  async function addFile() {
    const suggestion =
      state.runtimeLanguage === "Rust"
        ? "src/utils.rs"
        : state.runtimeLanguage === "HTML"
          ? "styles.css"
          : "utils.py";
    const filename = window.prompt("New file name (you can include folders):", suggestion);
    if (filename == null) {
      return;
    }

    const trimmed = String(filename).trim();
    if (isInvalidFilename(trimmed)) {
      setSaveState("Invalid file name");
      return;
    }

    if (!isAllowedLanguageFile(trimmed)) {
      setSaveState(
        state.runtimeLanguage === "Rust"
          ? "Rust exam mode only allows .rs files."
          : state.runtimeLanguage === "HTML"
            ? "HTML exam mode allows .html, .css, and .js files."
            : "Python exam mode only allows .py files."
      );
      return;
    }

    if (state.files[trimmed] != null) {
      setSaveState("File already exists");
      return;
    }

    persistActiveFile();
    state.files[trimmed] = starterForFilename(trimmed);
    state.activeFile = trimmed;
    activeFileName.textContent = trimmed;
    editor.value = state.files[trimmed];
    renderFiles();
    await saveWorkspace("FILE_ADDED");
  }

  async function renameActiveFile() {
    if (!state.activeFile || !Object.prototype.hasOwnProperty.call(state.files, state.activeFile)) {
      setSaveState("Select a file first");
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
      setSaveState("Invalid file name");
      return;
    }

    if (!isAllowedLanguageFile(nextName)) {
      setSaveState(
        state.runtimeLanguage === "Rust"
          ? "Rust exam mode only allows .rs files."
          : state.runtimeLanguage === "HTML"
            ? "HTML exam mode allows .html, .css, and .js files."
            : "Python exam mode only allows .py files."
      );
      return;
    }

    if (state.files[nextName] != null) {
      setSaveState("File already exists");
      return;
    }

    const mainFile = languageMainFile();
    if (state.activeFile === mainFile) {
      setSaveState(`Keep main file as ${mainFile}`);
      return;
    }

    const content = state.files[state.activeFile];
    delete state.files[state.activeFile];
    state.files[nextName] = content;
    state.activeFile = nextName;
    activeFileName.textContent = nextName;
    editor.value = state.files[nextName];
    renderFiles();
    await saveWorkspace("FILE_RENAMED");
  }

  editor.addEventListener("input", () => {
    persistActiveFile();
    syncCurrentAnsweredState();
    state.questionDirty = true;
    setSaveState("Unsaved");
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
      saveWorkspace("AUTOSAVE").catch(() => setSaveState("Sync failed"));
    }, 900);
  });

  stdinEditor.addEventListener("input", () => {
    persistActiveFile();
    state.questionDirty = true;
  });

  textAnswerEditor.addEventListener("input", () => {
    state.answerText = textAnswerEditor.value;
    state.questionDirty = true;
    textAnswerCount.textContent = `${state.answerText.trim() ? state.answerText.trim().split(/\s+/).length : 0} words`;
    syncCurrentAnsweredState();
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => saveWorkspace("AUTOSAVE").catch(() => setSaveState("Sync failed")), 900);
  });

  multipleChoiceOptions.addEventListener("change", (event) => {
    if (event.target.name !== "questionChoice") return;
    state.selectedOption = event.target.value;
    state.questionDirty = true;
    textAnswerCount.textContent = "Selected";
    syncCurrentAnsweredState();
    saveWorkspace("AUTOSAVE").catch(() => setSaveState("Sync failed"));
  });

  document.getElementById("runButton").addEventListener("click", () => {
    runCode().catch(() => {
      consoleOutput.textContent = "No output.";
    });
  });

  addFileButton.addEventListener("click", () => {
    addFile().catch(() => {
      setSaveState("Unable to add file");
    });
  });

  renameFileButton.addEventListener("click", () => {
    renameActiveFile().catch(() => {
      setSaveState("Unable to rename file");
    });
  });

  document.getElementById("saveButton").addEventListener("click", () => {
    saveWorkspace("MANUAL_SAVE").catch(() => setSaveState("Sync failed"));
  });

  document.getElementById("submitButton").addEventListener("click", () => {
    renderSubmissionReview();
    submissionReviewModal.classList.remove("hidden");
  });

  confirmFinalSubmitButton.addEventListener("click", () => {
    submitExam().catch(() => {
      consoleOutput.textContent = "No output.";
    });
  });

  document.getElementById("exitButton").addEventListener("click", () => {
    exitExam().catch(() => {
      consoleOutput.textContent = "No output.";
    });
  });

  flagQuestionButton.addEventListener("click", toggleFlag);
  markAnsweredButton.addEventListener("click", toggleAnswered);
  prevQuestionButton.addEventListener("click", () => goToPreviousQuestion().catch(() => { consoleOutput.textContent = "No output."; }));
  nextQuestionButton.addEventListener("click", () => goToNextQuestion().catch(() => { consoleOutput.textContent = "No output."; }));
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
    openQuestion(Number(button.getAttribute("data-jump-question"))).catch(() => {
      consoleOutput.textContent = "No output.";
    });
  });
  submissionReviewList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-review-question]");
    if (!button) return;
    submissionReviewModal.classList.add("hidden");
    openQuestion(Number(button.getAttribute("data-review-question"))).catch(() => {
      consoleOutput.textContent = "No output.";
    });
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
