const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, ipcMain, session } = require("electron");
try {
  // Optional in packaged builds.
  // eslint-disable-next-line global-require
  require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });
} catch (error) {}

const nativeHook = require("./services/nativeHook");
const { createExamRuntimeScript } = require("./services/examRuntime");

function readWorkstationConfig() {
  const candidates = [
    path.resolve(process.resourcesPath || "", "workstation-config.json"),
    path.resolve(__dirname, "..", "workstation-resources", "workstation-config.json")
  ];
  try {
    const configPath = candidates.find((candidate) => fs.existsSync(candidate));
    return configPath ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};
  } catch (_error) {
    return {};
  }
}

const isDev = !app.isPackaged;
const enableDevTools = process.env.ENABLE_SECURE_DEVTOOLS === "true";
const workstationConfig = readWorkstationConfig();
const configuredServerPath = () => path.join(app.getPath("userData"), "workstation-server.json");

function readSavedServerUrl() {
  try {
    return JSON.parse(fs.readFileSync(configuredServerPath(), "utf8")).serverUrl || "";
  } catch (_error) {
    return "";
  }
}

function normalizeServerUrl(value = "") {
  const server = new URL(String(value).trim());
  if (!["http:", "https:"].includes(server.protocol)) throw new Error("Use an http:// or https:// server address.");
  server.pathname = "";
  server.search = "";
  server.hash = "";
  return server.toString().replace(/\/$/, "");
}

let backendUrl = process.env.CLOUDIDE_SECURE_BACKEND_URL || workstationConfig.serverUrl || readSavedServerUrl() || "";
let cloudideBaseUrl = process.env.CLOUDIDE_BASE_URL || backendUrl;
const cloudideExamPath = process.env.CLOUDIDE_EXAM_PATH || "/ide";
let allowedOrigin = process.env.CLOUDIDE_ALLOWED_ORIGIN || cloudideBaseUrl;
const secureSessionToken =
  process.env.CLOUDIDE_SECURE_SESSION_TOKEN || "SECURE_SESSION_TOKEN";
const protocolName = "cloudidesecure";

let mainWindow;
let allowWindowClose = false;
let focusGuardInterval = null;
let embeddedBackend = null;
let isExamLocked = false;
let startupLogPath = "";
let launchContext = {
  session: {
    id: process.env.SESSION_ID || "",
    accessCode: process.env.SESSION_ACCESS_CODE || ""
  },
  student: {
    id: process.env.STUDENT_ID || "",
    name: process.env.STUDENT_NAME || "",
    studentNumber: process.env.STUDENT_NUMBER || ""
  },
  exam: {
    id: process.env.EXAM_ID || ""
  },
  mode: ""
};

function getStartupLogPath() {
  if (!startupLogPath) {
    startupLogPath = path.join(app.getPath("userData"), "startup.log");
  }

  return startupLogPath;
}

function logStartup(message, extra = null) {
  try {
    const timestamp = new Date().toISOString();
    const detail = extra ? ` ${JSON.stringify(extra)}` : "";
    fs.mkdirSync(path.dirname(getStartupLogPath()), { recursive: true });
    fs.appendFileSync(getStartupLogPath(), `[${timestamp}] ${message}${detail}\n`);
  } catch (error) {}
}

function parseDeepLink(argv) {
  const deepLink = argv.find((arg) => typeof arg === "string" && arg.startsWith(`${protocolName}://`));
  if (!deepLink) {
    return null;
  }

  try {
    const parsed = new URL(deepLink);
    return {
      session: {
        id: parsed.searchParams.get("sessionId") || "",
        accessCode: parsed.searchParams.get("accessCode") || ""
      },
      student: {
        id: parsed.searchParams.get("studentId") || "",
        name: parsed.searchParams.get("studentName") || "",
        studentNumber: parsed.searchParams.get("studentNumber") || ""
      },
      exam: {
        id: parsed.searchParams.get("examId") || ""
      },
      mode: parsed.searchParams.get("mode") || ""
    };
  } catch (error) {
    return null;
  }
}

function registerProtocolClient() {
  if (process.defaultApp && process.argv.length >= 2) {
    return app.setAsDefaultProtocolClient(protocolName, process.execPath, [path.resolve(process.argv[1])]);
  }

  return app.setAsDefaultProtocolClient(protocolName, process.execPath);
}

function sameLaunchContext(a, b) {
  return (
    a?.session?.id === b?.session?.id &&
    a?.student?.id === b?.student?.id &&
    a?.exam?.id === b?.exam?.id &&
    a?.mode === b?.mode
  );
}

function secureConfig() {
  return {
    backendUrl,
    secureSessionToken,
    session: launchContext.session,
    student: launchContext.student,
    exam: launchContext.exam
  };
}

function postSecurityEvent(event, metadata = {}, progress) {
  const config = secureConfig();
  if (!config.session.id || !config.student.id || !config.exam.id) {
    return Promise.resolve();
  }

  const payload = {
    event,
    timestamp: Date.now(),
    metadata,
    progress,
    sessionId: config.session.id,
    studentId: config.student.id,
    studentName: config.student.name,
    examId: config.exam.id
  };

  return fetch(`${backendUrl}/api/exam/event`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Exam-Token": secureSessionToken
    },
    body: JSON.stringify(payload)
  }).catch(() => {});
}

function enforceFocus(reason) {
  if (!isExamLocked || !mainWindow || mainWindow.isDestroyed() || allowWindowClose) {
    return;
  }

  mainWindow.setKiosk(true);
  mainWindow.setFullScreen(true);
  mainWindow.setAlwaysOnTop(true, "screen-saver");
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  postSecurityEvent(reason, { source: "main-process-focus-guard" });
}

function isAllowedCloudIdeUrl(target) {
  try {
    const url = new URL(target);
    return url.origin === allowedOrigin;
  } catch (error) {
    return false;
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    show: true,
    fullscreen: false,
    kiosk: false,
    alwaysOnTop: false,
    focusable: true,
    minimizable: true,
    maximizable: true,
    skipTaskbar: false,
    autoHideMenuBar: true,
    icon: path.resolve(__dirname, "..", "..", "assets", "brand", "ezproctor-logo.png"),
    backgroundColor: "#0b1120",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  mainWindow.loadFile(path.join(__dirname, "boot.html"));
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.once("ready-to-show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.show();
    mainWindow.focus();
    mainWindow.moveTop();
  });

  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isAllowedCloudIdeUrl(targetUrl)) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAllowedCloudIdeUrl(url)) {
      return { action: "deny" };
    }

    return { action: "allow" };
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    const blockedKeys = ["F11", "F12"];
    const blocksDevTools = input.control && input.shift && input.key.toUpperCase() === "I";
    const blocksReload = input.control && input.key.toUpperCase() === "R";

    if (blockedKeys.includes(input.key) || blocksDevTools || blocksReload) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.on("did-finish-load", () => {
    const injection = createExamRuntimeScript(secureConfig());

    mainWindow.webContents.executeJavaScript(injection).catch(() => {});
  });

  mainWindow.on("blur", () => enforceFocus("FOCUS_LOST"));
  mainWindow.on("minimize", (event) => {
    event.preventDefault();
    enforceFocus("MINIMIZE_ATTEMPT");
  });
  mainWindow.on("leave-full-screen", () => enforceFocus("FULLSCREEN_EXIT"));
  mainWindow.on("hide", () => enforceFocus("WINDOW_SWITCH"));
  mainWindow.on("show", () => {
    if (isExamLocked && !allowWindowClose) {
      mainWindow.setAlwaysOnTop(true, "screen-saver");
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.on("close", (event) => {
    if (!allowWindowClose) {
      event.preventDefault();
    }
  });

  if (isDev && enableDevTools) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

async function waitForBackendReady(timeoutMs = 45000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${backendUrl}/health`);
      if (response.ok) {
        return true;
      }
    } catch (error) {}

    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  return false;
}

function updateBootState(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("secure-client:boot-state", payload);
}

async function enterExamMode() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const examUrl = new URL(cloudideExamPath, cloudideBaseUrl).toString();
  logStartup("Loading exam URL", { examUrl });
  updateBootState({ phase: "loading-ide", message: "Loading secure IDE..." });
  await mainWindow.loadURL(examUrl);

  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  await mainWindow.webContents.executeJavaScript(createExamRuntimeScript(secureConfig())).catch(() => {});
  isExamLocked = true;
  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setFullScreen(true);
  mainWindow.setKiosk(true);
  mainWindow.setResizable(false);
  mainWindow.setMinimizable(false);
  mainWindow.setMaximizable(false);
  mainWindow.focus();
  mainWindow.moveTop();
  enforceFocus("WINDOW_SWITCH");
  logStartup("Entered exam mode");
}

async function startExamWindow() {
  try {
    updateBootState({ phase: "starting", message: "Preparing secure exam environment..." });

    if (workstationConfig.deploymentMode === "central-server" && !backendUrl) {
      updateBootState({ phase: "configuration", message: "Enter your institution's EzProctor server address." });
      return;
    }

    if (shouldStartEmbeddedBackend()) {
      logStartup("Starting embedded backend");
      process.env.CLOUDIDE_SECURE_DATA_DIR = path.join(app.getPath("userData"), "backend-data");
      const { startServer } = require(path.resolve(__dirname, "..", "..", "backend", "src", "server.js"));
      embeddedBackend = startServer(Number(process.env.BACKEND_PORT || 8787));
    }

    updateBootState({ phase: "backend", message: `Connecting to exam server ${backendUrl}...` });
    const backendReady = await waitForBackendReady();
    if (!backendReady) {
      throw new Error(`Backend did not become ready at ${backendUrl}/health`);
    }

    logStartup("Backend ready");
    if (launchContext.mode === "ide") {
      await enterExamMode();
      if (focusGuardInterval) {
        clearInterval(focusGuardInterval);
      }
      focusGuardInterval = setInterval(() => enforceFocus("MULTIPLE_SWITCH_ATTEMPTS"), 1500);
      return;
    }

    updateBootState({ phase: "ready", message: "Opening student home..." });
    const homeUrl = new URL("/", cloudideBaseUrl).toString();
    await mainWindow.loadURL(homeUrl);
    isExamLocked = false;
  } catch (error) {
    logStartup("Startup failed", { message: error.message });
    updateBootState({
      phase: "error",
      message: error.message,
      startupLogPath: getStartupLogPath(),
      backendUrl
    });
  }
}

function shouldStartEmbeddedBackend() {
  if (process.env.START_EMBEDDED_BACKEND === "true") return true;
  if (process.env.START_EMBEDDED_BACKEND === "false") return false;
  return app.isPackaged && workstationConfig.deploymentMode !== "central-server" && !backendUrl;
}

async function unlockAndClose(reason = "exit") {
  logStartup("Unlocking and closing exam window", { reason });
  allowWindowClose = true;
  isExamLocked = false;
  if (focusGuardInterval) {
    clearInterval(focusGuardInterval);
    focusGuardInterval = null;
  }
  await nativeHook.disable();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setKiosk(false);
    mainWindow.setFullScreen(false);
    mainWindow.setAlwaysOnTop(false);
    mainWindow.close();
  }

  return { ok: true, reason };
}

ipcMain.handle("secure-client:get-config", () => ({
  ...secureConfig()
}));

ipcMain.handle("secure-client:get-lockdown-status", async () => nativeHook.getStatus());

ipcMain.handle("secure-client:set-lockdown", async (_event, enabled) => {
  if (enabled) {
    isExamLocked = true;
    const hookStatus = await nativeHook.enable();
    if (focusGuardInterval) {
      clearInterval(focusGuardInterval);
    }
    focusGuardInterval = setInterval(() => enforceFocus("MULTIPLE_SWITCH_ATTEMPTS"), 1500);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(true, "screen-saver");
      mainWindow.setFullScreen(true);
      mainWindow.setKiosk(true);
      mainWindow.setResizable(false);
      mainWindow.setMinimizable(false);
      mainWindow.setMaximizable(false);
      mainWindow.focus();
      mainWindow.moveTop();
    }
    return hookStatus;
  }

  isExamLocked = false;
  if (focusGuardInterval) {
    clearInterval(focusGuardInterval);
    focusGuardInterval = null;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setKiosk(false);
    mainWindow.setFullScreen(false);
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setResizable(true);
    mainWindow.setMinimizable(true);
    mainWindow.setMaximizable(true);
  }
  return nativeHook.disable();
});

ipcMain.handle("secure-client:submit-exam", async (_event, payload = {}) =>
  unlockAndClose(payload.reason || "submitted")
);

ipcMain.handle("secure-client:exit-exam", async (_event, payload = {}) =>
  unlockAndClose(payload.reason || "exit-requested")
);

ipcMain.handle("secure-client:retry-startup", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
  }

  await startExamWindow();
  return { ok: true };
});

ipcMain.handle("secure-client:configure-server", async (_event, value) => {
  try {
    const serverUrl = normalizeServerUrl(value);
    const response = await fetch(`${serverUrl}/health`);
    if (!response.ok) throw new Error("The server health check did not succeed.");
    fs.mkdirSync(path.dirname(configuredServerPath()), { recursive: true });
    fs.writeFileSync(configuredServerPath(), `${JSON.stringify({ serverUrl }, null, 2)}\n`, { mode: 0o600 });
    backendUrl = serverUrl;
    cloudideBaseUrl = serverUrl;
    allowedOrigin = serverUrl;
    await startExamWindow();
    return { ok: true, serverUrl };
  } catch (error) {
    return { ok: false, error: `Unable to connect: ${error.message}` };
  }
});

app.whenReady().then(async () => {
  const deepLinkContext = parseDeepLink(process.argv);
  if (deepLinkContext) {
    launchContext = deepLinkContext;
  }

  registerProtocolClient();
  createMainWindow();
  await startExamWindow();
});

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const deepLinkContext = parseDeepLink(argv);
    if (deepLinkContext && !sameLaunchContext(deepLinkContext, launchContext)) {
      launchContext = deepLinkContext;
    } else if (deepLinkContext && isExamLocked) {
      return;
    }

    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
      mainWindow.moveTop();
      if (isExamLocked) {
        return;
      } else {
        startExamWindow().catch(() => {});
      }
    }
  });
}

app.on("activate", () => {
  if (!mainWindow) {
    createMainWindow();
    startExamWindow().catch(() => {});
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  mainWindow.moveTop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  allowWindowClose = true;
  if (embeddedBackend) {
    embeddedBackend.close();
  }
  await nativeHook.disable();
});
