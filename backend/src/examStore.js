const languageTemplates = {
  Python: {
    "main.py": ""
  },
  Rust: {
    "src/main.rs": ""
  },
  HTML: {
    "index.html": ""
  }
};

function normalizeLanguage(language = "") {
  const normalized = String(language).trim().toLowerCase();
  if (normalized.includes("rust") || normalized.includes("rush") || normalized === "rs") {
    return "Rust";
  }
  if (normalized.includes("html") || normalized.includes("frontend") || normalized === "web") {
    return "HTML";
  }
  return "Python";
}

function getDefaultFilesForLanguage(language = "Python") {
  const resolved = normalizeLanguage(language);
  const template = languageTemplates[resolved] || languageTemplates.Python;
  return JSON.parse(JSON.stringify(template));
}

function toLineComments(text = "") {
  return String(text)
    .split("\n")
    .map((line) => `// ${line}`)
    .join("\n");
}

function dropLegacyNoise(files = {}) {
  const cleaned = { ...(files || {}) };
  delete cleaned["README.md"];
  delete cleaned["input.txt"];
  return cleaned;
}

function cleanupPythonFiles(files = {}) {
  const source = { ...(files || {}) };
  return Object.fromEntries(Object.entries(source).filter(([name]) => name.endsWith(".py")));
}

function cleanupRustFiles(files = {}) {
  const source = { ...(files || {}) };
  return Object.fromEntries(Object.entries(source).filter(([name]) => name.endsWith(".rs")));
}

function cleanupHtmlFiles(files = {}) {
  const source = { ...(files || {}) };
  return Object.fromEntries(
    Object.entries(source).filter(([name]) => /\.(html|css|js)$/i.test(name))
  );
}

function mapFilesForLanguage(language = "Python", files = {}) {
  const resolved = normalizeLanguage(language);
  const source = dropLegacyNoise(files || {});

  if (resolved === "HTML") {
    const htmlCleaned = cleanupHtmlFiles(source);
    if (!htmlCleaned["index.html"]) {
      htmlCleaned["index.html"] = getDefaultFilesForLanguage("HTML")["index.html"];
    }
    return htmlCleaned;
  }

  if (resolved !== "Rust") {
    const pythonCleaned = cleanupPythonFiles(source);
    if (!pythonCleaned["main.py"]) {
      pythonCleaned["main.py"] = getDefaultFilesForLanguage("Python")["main.py"];
    }
    return pythonCleaned;
  }

  const defaults = getDefaultFilesForLanguage("Rust");
  const mapped = cleanupRustFiles(source);

  const hasRustEntrypoint = Boolean(mapped["src/main.rs"] || mapped["main.rs"]);
  if (!hasRustEntrypoint && mapped["main.py"]) {
    mapped["src/main.rs"] = `${defaults["src/main.rs"]}\n\n/*\nMigrated reference from main.py:\n${toLineComments(mapped["main.py"])}\n*/\n`;
  }

  if (!mapped["src/main.rs"] && mapped["main.rs"]) {
    mapped["src/main.rs"] = mapped["main.rs"];
  }

  if (!mapped["src/main.rs"]) {
    mapped["src/main.rs"] = defaults["src/main.rs"];
  }

  if (mapped["main.rs"]) {
    delete mapped["main.rs"];
  }

  return mapped;
}

const defaultFiles = getDefaultFilesForLanguage("Python");

const workspaces = new Map();

function ensureWorkspace(studentId) {
  if (!workspaces.has(studentId)) {
    workspaces.set(studentId, {
      files: { ...defaultFiles },
      submitted: false,
      submittedAt: null,
      lastRun: null
    });
  }

  return workspaces.get(studentId);
}

function getWorkspace(studentId) {
  return ensureWorkspace(studentId);
}

function saveWorkspace(studentId, files) {
  const workspace = ensureWorkspace(studentId);
  workspace.files = { ...workspace.files, ...files };
  return workspace;
}

function markSubmitted(studentId) {
  const workspace = ensureWorkspace(studentId);
  workspace.submitted = true;
  workspace.submittedAt = new Date().toISOString();
  return workspace;
}

function setLastRun(studentId, result) {
  const workspace = ensureWorkspace(studentId);
  workspace.lastRun = {
    ...result,
    at: new Date().toISOString()
  };
  return workspace;
}

module.exports = {
  defaultFiles,
  getDefaultFilesForLanguage,
  mapFilesForLanguage,
  getWorkspace,
  saveWorkspace,
  markSubmitted,
  setLastRun
};
