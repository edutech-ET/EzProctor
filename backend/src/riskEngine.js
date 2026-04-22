const weights = {
  TAB_SWITCH: 20,
  PASTE_ATTEMPT: 30,
  WINDOW_SWITCH: 25,
  LARGE_CODE_INJECTION: 40,
  DEVTOOLS_ATTEMPT: 15,
  COPY_ATTEMPT: 15,
  IDLE_SPIKE: 10,
  FOCUS_LOST: 25,
  FULLSCREEN_EXIT: 35,
  MINIMIZE_ATTEMPT: 35,
  LOCKDOWN_HELPER_ERROR: 45,
  MULTIPLE_SWITCH_ATTEMPTS: 30,
  RAPID_PASTE_PATTERN: 35,
  RUN_ERROR: 5
};

function calculateRisk(events) {
  let score = events.reduce((total, event) => total + (weights[event.type] || 0), 0);

  const recentSwitches = events.filter((event) =>
    ["TAB_SWITCH", "WINDOW_SWITCH", "FOCUS_LOST", "MINIMIZE_ATTEMPT"].includes(event.type)
  );

  if (recentSwitches.length >= 3) {
    score += 20;
  }

  if (events.filter((event) => event.type === "PASTE_ATTEMPT").length >= 2) {
    score += 20;
  }

  return Math.min(score, 100);
}

function deriveSignals(events) {
  const signals = [];
  const switches = events.filter((event) =>
    ["TAB_SWITCH", "WINDOW_SWITCH", "FOCUS_LOST", "MINIMIZE_ATTEMPT"].includes(event.type)
  ).length;
  const pastes = events.filter((event) => event.type === "PASTE_ATTEMPT").length;

  if (switches >= 3) {
    signals.push("Repeated focus switching");
  }

  if (pastes >= 2) {
    signals.push("Repeated paste attempts");
  }

  if (events.some((event) => event.type === "FULLSCREEN_EXIT")) {
    signals.push("Fullscreen exit attempt");
  }

  if (events.some((event) => event.type === "LOCKDOWN_HELPER_ERROR")) {
    signals.push("Lockdown helper error");
  }

  if (events.some((event) => event.type === "DEVTOOLS_ATTEMPT")) {
    signals.push("Developer tools attempt");
  }

  if (events.some((event) => event.type === "LARGE_CODE_INJECTION")) {
    signals.push("Large code injection pattern");
  }

  return signals;
}

function deriveStatus(score) {
  if (score >= 70) {
    return "Critical";
  }

  if (score >= 40) {
    return "Suspicious";
  }

  return "Normal";
}

module.exports = {
  calculateRisk,
  deriveSignals,
  deriveStatus,
  weights
};
