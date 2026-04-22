(async () => {
  const state = {
    config: null,
    auth: {
      sessionId: "open-session",
      studentId: "open-student",
      studentName: "Open Student",
      examId: "open-exam"
    },
    files: {},
    activeFile: "main.py",
    saveTimer: null
  };

  const editor = document.getElementById("editor");
  const stdinEditor = document.getElementById("stdinEditor");
  const fileList = document.getElementById("fileList");
  const consoleOutput = document.getElementById("consoleOutput");
  const saveState = document.getElementById("saveState");
  const studentLabel = document.getElementById("studentLabel");
  const activeFileName = document.getElementById("activeFileName");

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

  async function getConfig() {
    if (window.secureClient?.getConfig) {
      return window.secureClient.getConfig();
    }

    return {
      backendUrl: window.location.origin,
      secureSessionToken: "SECURE_SESSION_TOKEN"
    };
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
    state.files[state.activeFile] = editor.value;
    state.files["input.txt"] = stdinEditor.value;
  }

  function renderFiles() {
    fileList.innerHTML = "";

    Object.keys(state.files).forEach((filename) => {
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
    setSaveState("Saving");

    await api("/api/exam/workspace", {
      method: "POST",
      body: JSON.stringify({
        ...authPayload(),
        files: state.files
      })
    });

    setSaveState("Saved");
  }

  async function runCode() {
    await saveWorkspace();
    consoleOutput.textContent = "Running Python...";

    const result = await api("/api/exam/run", {
      method: "POST",
      body: JSON.stringify({
        ...authPayload(),
        files: state.files,
        stdin: stdinEditor.value
      })
    });

    consoleOutput.textContent = [
      result.command ? `$ ${result.command}` : "",
      result.stdout || "",
      result.stderr || ""
    ]
      .filter(Boolean)
      .join("\n");
  }

  async function submitExam() {
    await saveWorkspace();
    await api("/api/exam/submit", {
      method: "POST",
      body: JSON.stringify({
        ...authPayload(),
        files: state.files
      })
    });

    await window.secureClient?.submitExam({ reason: "submitted-from-open-mode" });
  }

  async function exitExam() {
    await saveWorkspace();
    await window.secureClient?.exitExam({ reason: "open-mode-exit" });
  }

  async function loadWorkspace() {
    const workspace = await api("/api/exam/workspace");
    state.files = workspace.files;
    state.activeFile = Object.keys(state.files)[0];
    editor.value = state.files[state.activeFile];
    stdinEditor.value = state.files["input.txt"] || "";
    activeFileName.textContent = state.activeFile;
    renderFiles();
    setSaveState("Ready");
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

  document.getElementById("saveButton").addEventListener("click", () => {
    saveWorkspace().catch(() => setSaveState("Save failed"));
  });

  document.getElementById("submitButton").addEventListener("click", () => {
    submitExam().catch((error) => {
      consoleOutput.textContent = error.message;
    });
  });

  document.getElementById("exitButton").addEventListener("click", () => {
    exitExam().catch((error) => {
      consoleOutput.textContent = error.message;
    });
  });

  state.config = await getConfig();
  studentLabel.textContent = "Open IDE mode active.";
  await loadWorkspace();
  await window.secureClient?.setLockdown(true);
})();

