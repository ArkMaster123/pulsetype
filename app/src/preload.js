const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("localWhispr", {
  getStatus: () => ipcRenderer.invoke("app:getStatus"),
  toggleRecording: () => ipcRenderer.invoke("app:toggleRecording"),
  setModel: (modelSize) => ipcRenderer.invoke("app:setModel", modelSize),
  setConfig: (configPatch) => ipcRenderer.invoke("app:setConfig", configPatch),
  downloadModel: () => ipcRenderer.invoke("app:downloadModel"),
  onLog: (callback) => {
    const handler = (_event, message) => callback(message);
    ipcRenderer.on("app:log", handler);
    return () => ipcRenderer.removeListener("app:log", handler);
  }
});
