function createExamRuntimeScript(config) {
  return `
    (() => {
      const secureConfig = ${JSON.stringify(config)};
      const runtimeIdentity = {
        sessionId: "",
        studentId: secureConfig.student?.id || "",
        studentName: secureConfig.student?.name || "",
        examId: secureConfig.exam?.id || ""
      };

      const canPost = () =>
        Boolean(runtimeIdentity.sessionId && runtimeIdentity.studentId && runtimeIdentity.examId);

      const post = (path, payload) => {
        if (!canPost()) {
          return Promise.resolve();
        }

        return fetch(\`\${secureConfig.backendUrl}\${path}\`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Exam-Token": secureConfig.secureSessionToken
          },
          body: JSON.stringify({
            ...payload,
            sessionId: runtimeIdentity.sessionId,
            studentId: runtimeIdentity.studentId,
            studentName: runtimeIdentity.studentName,
            examId: runtimeIdentity.examId
          })
        }).catch(() => {});
      };

      const logEvent = (event, metadata = {}) =>
        post("/api/exam/event", {
          event,
          timestamp: Date.now(),
          metadata,
          progress: metadata.progress
        });

      const sendSnapshot = (currentActivity, progress = 0) =>
        post("/api/exam/snapshot", {
          currentActivity,
          progress,
          timestamp: Date.now()
        });

      window.examMode = true;
      window.examToken = secureConfig.secureSessionToken;
      window.secureBackendUrl = secureConfig.backendUrl;
      window.secureExamContext = secureConfig;
      window.secureExamRuntime = {
        setIdentity(identity) {
          runtimeIdentity.sessionId = identity.sessionId || "";
          runtimeIdentity.studentId = identity.studentId || "";
          runtimeIdentity.studentName = identity.studentName || "";
          runtimeIdentity.examId = identity.examId || "";
        },
        logEvent,
        sendSnapshot
      };

      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          logEvent("TAB_SWITCH");
        }
      });

      document.addEventListener("paste", () => logEvent("PASTE_ATTEMPT"));
      document.addEventListener("copy", () => logEvent("COPY_ATTEMPT"));
      document.addEventListener("cut", () => logEvent("CUT_ATTEMPT"));

      let hasFocusedOnce = false;
      window.addEventListener("focus", () => {
        hasFocusedOnce = true;
      });

      window.addEventListener("blur", () => {
        if (hasFocusedOnce) {
          logEvent("WINDOW_SWITCH");
        }
      });

      document.addEventListener("keydown", (event) => {
        const lowerKey = event.key.toLowerCase();
        const blockedCombo =
          event.key === "F12" ||
          (event.ctrlKey && event.shiftKey && lowerKey === "i") ||
          (event.altKey && event.key === "Tab") ||
          (event.altKey && event.key === "Escape") ||
          (event.ctrlKey && event.shiftKey && lowerKey === "escape");

        if (blockedCombo) {
          logEvent("DEVTOOLS_ATTEMPT");
          event.preventDefault();
        }
      });

      document.addEventListener("fullscreenchange", () => {
        if (canPost() && !document.fullscreenElement) {
          logEvent("FULLSCREEN_EXIT");
        }
      });

      setInterval(() => {
        if (canPost()) {
          sendSnapshot("Exam Active", 5);
        }
      }, 15000);
    })();
  `;
}

module.exports = {
  createExamRuntimeScript
};
