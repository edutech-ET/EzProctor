const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

let initialized = false;
let enabled = false;
let helperProcess = null;
let lastError = null;
let mode = "powershell-hook";
const runtimeDir = path.resolve(process.cwd(), "electron", ".runtime");
const statusFile = path.join(runtimeDir, "lockdown-status.txt");
const logFile = path.join(runtimeDir, "lockdown-hook.log");

function scriptPath() {
  return path.resolve(process.cwd(), "electron", "scripts", "lockdown-hook.ps1");
}

function ensureRuntimeDir() {
  fs.mkdirSync(runtimeDir, { recursive: true });
}

function readStatusFile() {
  try {
    return fs.readFileSync(statusFile, "utf8").trim();
  } catch (error) {
    return "";
  }
}

function killStaleHelpers() {
  const command =
    "Get-CimInstance Win32_Process -Filter \"name = 'powershell.exe'\" | " +
    "Where-Object { $_.CommandLine -like '*lockdown-hook.ps1*' } | " +
    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";

  try {
    spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
      windowsHide: true
    });
  } catch (error) {
    lastError = error.message;
  }
}

function cleanupHelperState() {
  if (helperProcess) {
    helperProcess.removeAllListeners();
    helperProcess = null;
  }

  enabled = false;
}

async function initialize() {
  killStaleHelpers();
  initialized = true;
  return getStatus();
}

async function enable() {
  if (enabled && helperProcess) {
    return getStatus();
  }

  lastError = null;
  ensureRuntimeDir();
  fs.writeFileSync(statusFile, "starting", "utf8");

  try {
    helperProcess = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath(),
        "-StatusFile",
        statusFile,
        "-LogFile",
        logFile
      ],
      {
        stdio: "ignore",
        windowsHide: true
      }
    );

    helperProcess.once("error", (error) => {
      lastError = error.message;
      cleanupHelperState();
    });

    helperProcess.once("exit", (code) => {
      if (enabled && code !== 0) {
        lastError = `Lockdown helper exited unexpectedly with code ${code}`;
      }
      cleanupHelperState();
    });

    enabled = true;
  } catch (error) {
    lastError = error.message;
    cleanupHelperState();
  }

  return getStatus();
}

async function disable() {
  if (helperProcess && !helperProcess.killed) {
    try {
      process.kill(helperProcess.pid);
    } catch (error) {
      lastError = error.message;
    }
  }

  killStaleHelpers();
  cleanupHelperState();
  return getStatus();
}

function getStatus() {
  return {
    available: true,
    initialized,
    enabled,
    mode,
    helperPid: helperProcess?.pid || null,
    helperStatus: readStatusFile(),
    lastError
  };
}

module.exports = {
  initialize,
  enable,
  disable,
  getStatus
};
