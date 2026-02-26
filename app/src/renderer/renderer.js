const modelSelect = document.getElementById("model");
const languageSelect = document.getElementById("language");
const toggleRecordButton = document.getElementById("toggleRecord");
const downloadButton = document.getElementById("downloadModel");
const lmStudioEnabled = document.getElementById("lmStudioEnabled");
const lmStudioBaseUrl = document.getElementById("lmStudioBaseUrl");
const lmStudioModel = document.getElementById("lmStudioModel");
const statusList = document.getElementById("statusList");
const logs = document.getElementById("logs");
const voiceStage = document.getElementById("voiceStage");
const voiceLabel = document.getElementById("voiceLabel");
const liveState = document.getElementById("liveState");

function appendLog(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  logs.textContent = `${line}\n${logs.textContent}`.slice(0, 8000);
}

function renderStatus(status) {
  const modeHint =
    status.config.language === "zh"
      ? "Chinese mode"
      : status.config.language === "auto"
        ? "Auto language"
        : "English mode";

  const items = [
    `Hotkey: ${status.config.hotkey}`,
    `Recording: ${status.isRecording ? "yes" : "no"}`,
    `Transcribing: ${status.isTranscribing ? "yes" : "no"}`,
    `Model: ${status.config.modelSize} (${modeHint})`,
    `Model ready: ${status.modelExists ? "yes" : "no"}`,
    `whisper-cli installed: ${status.whisperInstalled ? "yes" : "no"}`,
    `Model path: ${status.modelPath}`
  ];

  statusList.innerHTML = items.map((item) => `<li>${item}</li>`).join("");
  toggleRecordButton.textContent = status.isRecording ? "Stop Dictation" : "Start Dictation";

  voiceStage.classList.remove("recording", "transcribing");
  if (status.isRecording) {
    voiceStage.classList.add("recording");
    voiceLabel.textContent = "Listening...";
    liveState.textContent = "Recording";
  } else if (status.isTranscribing) {
    voiceStage.classList.add("transcribing");
    voiceLabel.textContent = "Transcribing...";
    liveState.textContent = "Transcribing";
  } else {
    voiceLabel.textContent = "Ready";
    liveState.textContent = "Idle";
  }
}

async function refreshStatus() {
  const status = await window.localWhispr.getStatus();
  modelSelect.value = status.config.modelSize;
  languageSelect.value = status.config.language;
  lmStudioEnabled.checked = Boolean(status.config.lmStudioEnabled);
  lmStudioBaseUrl.value = status.config.lmStudioBaseUrl || "";
  lmStudioModel.value = status.config.lmStudioModel || "";
  renderStatus(status);
}

window.localWhispr.onLog((message) => {
  appendLog(message);
  refreshStatus().catch((error) => appendLog(error.message));
});

toggleRecordButton.addEventListener("click", async () => {
  try {
    const status = await window.localWhispr.toggleRecording();
    renderStatus({ ...(await window.localWhispr.getStatus()), ...status });
  } catch (error) {
    appendLog(`Error: ${error.message}`);
  }
});

downloadButton.addEventListener("click", async () => {
  try {
    await window.localWhispr.setConfig({ modelSize: modelSelect.value, language: languageSelect.value });
    appendLog(`Selected model: ${modelSelect.value}`);
    await window.localWhispr.downloadModel();
    appendLog("Model download completed.");
    await refreshStatus();
  } catch (error) {
    appendLog(`Download failed: ${error.message}`);
  }
});

modelSelect.addEventListener("change", async () => {
  await window.localWhispr.setConfig({ modelSize: modelSelect.value });
  appendLog(`Selected model: ${modelSelect.value}`);
  await refreshStatus();
});

languageSelect.addEventListener("change", async () => {
  await window.localWhispr.setConfig({ language: languageSelect.value });
  appendLog(`Language set to: ${languageSelect.value}`);
  await refreshStatus();
});

lmStudioEnabled.addEventListener("change", async () => {
  await window.localWhispr.setConfig({ lmStudioEnabled: lmStudioEnabled.checked });
  appendLog(`LM Studio polish: ${lmStudioEnabled.checked ? "on" : "off"}`);
  await refreshStatus();
});

lmStudioBaseUrl.addEventListener("change", async () => {
  await window.localWhispr.setConfig({ lmStudioBaseUrl: lmStudioBaseUrl.value.trim() });
  appendLog("LM Studio URL updated.");
});

lmStudioModel.addEventListener("change", async () => {
  await window.localWhispr.setConfig({ lmStudioModel: lmStudioModel.value.trim() });
  appendLog("LM Studio model updated.");
});

refreshStatus().catch((error) => appendLog(error.message));
