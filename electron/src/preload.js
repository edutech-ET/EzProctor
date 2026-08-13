const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("secureClient", {
  getConfig: () => ipcRenderer.invoke("secure-client:get-config"),
  getLockdownStatus: () => ipcRenderer.invoke("secure-client:get-lockdown-status"),
  setLockdown: (enabled) => ipcRenderer.invoke("secure-client:set-lockdown", enabled),
  submitExam: (payload) => ipcRenderer.invoke("secure-client:submit-exam", payload),
  exitExam: (payload) => ipcRenderer.invoke("secure-client:exit-exam", payload),
  retryStartup: () => ipcRenderer.invoke("secure-client:retry-startup"),
  configureServer: (serverUrl) => ipcRenderer.invoke("secure-client:configure-server", serverUrl),
  onBootState: (listener) => {
    if (typeof listener !== "function") {
      return () => {};
    }

    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on("secure-client:boot-state", wrapped);
    return () => ipcRenderer.removeListener("secure-client:boot-state", wrapped);
  }
});
