const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("localWhispr", {
  getStatus: () => ipcRenderer.invoke("app:getStatus"),
  toggleRecording: () => ipcRenderer.invoke("app:toggleRecording"),
  setModel: (modelSize) => ipcRenderer.invoke("app:setModel", modelSize),
  setConfig: (configPatch) => ipcRenderer.invoke("app:setConfig", configPatch),
  downloadModel: () => ipcRenderer.invoke("app:downloadModel"),
  scanHardware: () => ipcRenderer.invoke("app:scanHardware"),
  searchAudioModels: (query) => ipcRenderer.invoke("app:searchAudioModels", query),
  runBenchmark: () => ipcRenderer.invoke("app:runBenchmark"),
  getOpenRouterVoiceModels: () => ipcRenderer.invoke("app:getOpenRouterVoiceModels"),
  onTranscript: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("app:transcript", handler);
    return () => ipcRenderer.removeListener("app:transcript", handler);
  },
  onLog: (callback) => {
    const handler = (_event, message) => callback(message);
    ipcRenderer.on("app:log", handler);
    return () => ipcRenderer.removeListener("app:log", handler);
  }
});
