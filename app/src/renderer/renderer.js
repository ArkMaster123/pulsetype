const providerSelect = document.getElementById("provider");
const modelSelect = document.getElementById("model");
const mlxModelInput = document.getElementById("mlxModel");
const languageSelect = document.getElementById("language");
const hotkeyInput = document.getElementById("hotkeyInput");
const saveHotkeyButton = document.getElementById("saveHotkey");
const toggleRecordButton = document.getElementById("toggleRecord");
const downloadButton = document.getElementById("downloadModel");
const lmStudioEnabled = document.getElementById("lmStudioEnabled");
const lmStudioBaseUrl = document.getElementById("lmStudioBaseUrl");
const lmStudioModel = document.getElementById("lmStudioModel");
const openRouterEnabled = document.getElementById("openRouterEnabled");
const openRouterApiKey = document.getElementById("openRouterApiKey");
const openRouterBaseUrl = document.getElementById("openRouterBaseUrl");
const openRouterModel = document.getElementById("openRouterModel");
const refreshOpenRouterModels = document.getElementById("refreshOpenRouterModels");
const scanHardwareButton = document.getElementById("scanHardware");
const hardwareList = document.getElementById("hardwareList");
const runBenchmarkButton = document.getElementById("runBenchmark");
const clearBenchmarkButton = document.getElementById("clearBenchmark");
const benchmarkOutput = document.getElementById("benchmarkOutput");
const searchModelsButton = document.getElementById("searchModels");
const modelSearchInput = document.getElementById("modelSearch");
const modelSearchResults = document.getElementById("modelSearchResults");
const statusList = document.getElementById("statusList");
const logs = document.getElementById("logs");
const liveTranscript = document.getElementById("liveTranscript");
const voiceStage = document.getElementById("voiceStage");
const voiceLabel = document.getElementById("voiceLabel");
const liveState = document.getElementById("liveState");
const onboardingPanel = document.getElementById("onboardingPanel");
const modeLocalButton = document.getElementById("modeLocal");
const modeOpenRouterButton = document.getElementById("modeOpenRouter");
const onboardingCloudFields = document.getElementById("onboardingCloudFields");
const onboardingOpenRouterApiKey = document.getElementById("onboardingOpenRouterApiKey");
const onboardingContinue = document.getElementById("onboardingContinue");
const onboardingHint = document.getElementById("onboardingHint");

let onboardingSelection = null;

const PULSETYPE_ASCII = String.raw`
   .-""-.
  / .--. \
 / /    \ \
 | |    | |
 | |.-""-.|    PulseType
///'.::::.'\\\   listen -> transcribe -> paste
||| ::/  \:: ;
||| ::\__/:: ;
 \\\ '::::' /
  '=-..-='      ♪
`;

function appendLog(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  logs.textContent = `${line}\n${logs.textContent}`.slice(0, 12000);
}

function renderWelcomeArt() {
  logs.textContent = `${PULSETYPE_ASCII}\n\n${logs.textContent}`.slice(0, 12000);
}

function syncEngineToggleUI(provider) {
  document.querySelectorAll(".engine-toggle button").forEach((button) => {
    const isActive = button.dataset.provider === provider;
    button.classList.toggle("active", isActive);
  });
}

function updateOnboardingUI() {
  modeLocalButton.classList.toggle("active", onboardingSelection === "whispercpp");
  modeOpenRouterButton.classList.toggle("active", onboardingSelection === "openrouter");

  const needsCloud = onboardingSelection === "openrouter";
  onboardingCloudFields.classList.toggle("hidden", !needsCloud);

  if (!onboardingSelection) {
    onboardingContinue.textContent = "Choose a mode to continue";
    onboardingContinue.disabled = true;
    onboardingHint.textContent = "Recommended default: Local Whisper for privacy and zero cost.";
    return;
  }

  if (onboardingSelection === "whispercpp") {
    onboardingContinue.textContent = "Use Local Whisper";
    onboardingContinue.disabled = false;
    onboardingHint.textContent = "Local mode keeps audio on your device and works offline.";
    return;
  }

  const hasApiKey = Boolean(onboardingOpenRouterApiKey.value.trim() || openRouterApiKey.value.trim());
  onboardingContinue.textContent = hasApiKey ? "Use OpenRouter" : "Enter API key to continue";
  onboardingContinue.disabled = !hasApiKey;
  onboardingHint.textContent = "Cloud mode is often fast but depends on network and API credits.";
}

function setOnboardingSelection(mode) {
  onboardingSelection = mode;
  updateOnboardingUI();
}

async function applyOnboardingChoice() {
  if (!onboardingSelection) {
    return;
  }

  if (onboardingSelection === "whispercpp") {
    await savePatch(
      {
        transcriptionProvider: "whispercpp",
        openRouterEnabled: false
      },
      "Quick Start: Local Whisper selected."
    );
  } else {
    const apiKey = onboardingOpenRouterApiKey.value.trim() || openRouterApiKey.value.trim();
    if (!apiKey) {
      onboardingHint.textContent = "Enter your OpenRouter API key first.";
      onboardingContinue.disabled = true;
      return;
    }

    await savePatch(
      {
        transcriptionProvider: "whispercpp",
        openRouterEnabled: true,
        openRouterApiKey: apiKey
      },
      "Quick Start: OpenRouter mode enabled."
    );
  }

  localStorage.setItem("pulsetype.onboarding.dismissed", "true");
  onboardingPanel.classList.add("hidden");
}

function renderStatus(status) {
  const items = [
    `Hotkey: ${status.config.hotkey}`,
    `Provider: ${status.config.transcriptionProvider}`,
    `Whisper model: ${status.config.modelSize}`,
    `MLX model: ${status.config.mlxModel || "(not set)"}`,
    `OpenRouter model: ${status.config.openRouterModel || "(not set)"}`,
    `Recording: ${status.isRecording ? "yes" : "no"}`,
    `Transcribing: ${status.isTranscribing ? "yes" : "no"}`,
    `Model ready: ${status.modelExists ? "yes" : "no"}`,
    `whisper-cli installed: ${status.whisperInstalled ? "yes" : "no"}`,
    `python3 installed: ${status.pythonInstalled ? "yes" : "no"}`
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
  providerSelect.value = status.config.transcriptionProvider;
  modelSelect.value = status.config.modelSize;
  mlxModelInput.value = status.config.mlxModel || "";
  languageSelect.value = status.config.language;
  hotkeyInput.value = status.config.hotkey;
  lmStudioEnabled.checked = Boolean(status.config.lmStudioEnabled);
  lmStudioBaseUrl.value = status.config.lmStudioBaseUrl || "";
  lmStudioModel.value = status.config.lmStudioModel || "";
  openRouterEnabled.checked = Boolean(status.config.openRouterEnabled);
  openRouterApiKey.value = status.config.openRouterApiKey || "";
  openRouterBaseUrl.value = status.config.openRouterBaseUrl || "https://openrouter.ai/api/v1";
  await ensureOpenRouterModelOption(status.config.openRouterModel || "mistralai/voxtral-small-24b-2507");
  openRouterModel.value = status.config.openRouterModel || "mistralai/voxtral-small-24b-2507";
  syncEngineToggleUI(status.config.transcriptionProvider);

  const dismissed = localStorage.getItem("pulsetype.onboarding.dismissed") === "true";
  onboardingPanel.classList.toggle("hidden", dismissed);
  if (!dismissed) {
    if (status.config.openRouterEnabled && status.config.openRouterApiKey) {
      onboardingSelection = "openrouter";
    } else {
      onboardingSelection = "whispercpp";
    }
    onboardingOpenRouterApiKey.value = status.config.openRouterApiKey || "";
    updateOnboardingUI();
  }

  renderStatus(status);
}

async function ensureOpenRouterModelOption(modelId) {
  if (!modelId) {
    return;
  }
  const exists = Array.from(openRouterModel.options).some((option) => option.value === modelId);
  if (!exists) {
    const option = document.createElement("option");
    option.value = modelId;
    option.textContent = modelId;
    openRouterModel.appendChild(option);
  }
}

function setOpenRouterModels(models) {
  const selected = openRouterModel.value;
  openRouterModel.innerHTML = "";

  const withFallback = models.length
    ? models
    : [{ id: "mistralai/voxtral-small-24b-2507", name: "mistralai/voxtral-small-24b-2507" }];

  for (const model of withFallback) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.id;
    openRouterModel.appendChild(option);
  }

  if (selected && withFallback.some((x) => x.id === selected)) {
    openRouterModel.value = selected;
  }
}

function renderHardware(data) {
  const items = [
    `CPU: ${data.cpu}`,
    `Platform: ${data.platform}`,
    `Memory: ${data.memoryFreeGB} GB free / ${data.memoryTotalGB} GB total`,
    `Disk: ${data.diskFreeGB} GB free / ${data.diskTotalGB} GB total`,
    `Model cache: ${data.modelsOnDiskGB} GB`
  ];
  hardwareList.innerHTML = items.map((item) => `<li>${item}</li>`).join("");
}

function renderSearchResults(results) {
  if (!results.length) {
    modelSearchResults.innerHTML = "<li>No results</li>";
    return;
  }

  modelSearchResults.innerHTML = results
    .map(
      (model) =>
        `<li><span class="model-id">${model.id}</span><div class="model-meta">${model.downloads} downloads · ${model.likes} likes</div></li>`
    )
    .join("");
}

async function savePatch(patch, message) {
  const result = await window.localWhispr.setConfig(patch);
  if (!result.ok) {
    throw new Error(result.error || "Settings update failed");
  }
  if (message) {
    appendLog(message);
  }
  await refreshStatus();
}

window.localWhispr.onLog((message) => {
  appendLog(message);
  refreshStatus().catch((error) => appendLog(error.message));
});

window.localWhispr.onTranscript((payload) => {
  const { type, text } = payload || {};
  if (!liveTranscript) {
    return;
  }

  if (type === "clear") {
    liveTranscript.value = "";
    return;
  }

  if (type === "partial") {
    const prev = liveTranscript.value.trim();
    if (!prev) {
      liveTranscript.value = text;
    } else {
      liveTranscript.value = `${prev}\n${text}`;
    }
    liveTranscript.scrollTop = liveTranscript.scrollHeight;
    return;
  }

  if (type === "final") {
    liveTranscript.value = text || liveTranscript.value;
  }
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
    await savePatch(
      {
        modelSize: modelSelect.value,
        language: languageSelect.value,
        transcriptionProvider: providerSelect.value,
        mlxModel: mlxModelInput.value.trim()
      },
      "Updated model settings."
    );
    await window.localWhispr.downloadModel();
    appendLog("Whisper model download completed.");
  } catch (error) {
    appendLog(`Download failed: ${error.message}`);
  }
});

providerSelect.addEventListener("change", async () => {
  try {
    await savePatch({ transcriptionProvider: providerSelect.value }, `Provider set to ${providerSelect.value}.`);
    syncEngineToggleUI(providerSelect.value);
  } catch (error) {
    appendLog(error.message);
  }
});

modelSelect.addEventListener("change", async () => {
  try {
    await savePatch({ modelSize: modelSelect.value }, `Whisper model set to ${modelSelect.value}.`);
  } catch (error) {
    appendLog(error.message);
  }
});

mlxModelInput.addEventListener("change", async () => {
  try {
    await savePatch({ mlxModel: mlxModelInput.value.trim() }, "MLX model updated.");
  } catch (error) {
    appendLog(error.message);
  }
});

languageSelect.addEventListener("change", async () => {
  try {
    await savePatch({ language: languageSelect.value }, `Language set to ${languageSelect.value}.`);
  } catch (error) {
    appendLog(error.message);
  }
});

saveHotkeyButton.addEventListener("click", async () => {
  try {
    await savePatch({ hotkey: hotkeyInput.value.trim() }, `Hotkey updated to ${hotkeyInput.value.trim()}.`);
  } catch (error) {
    appendLog(`Hotkey update failed: ${error.message}`);
  }
});

lmStudioEnabled.addEventListener("change", async () => {
  try {
    await savePatch({ lmStudioEnabled: lmStudioEnabled.checked }, `LM Studio polish ${lmStudioEnabled.checked ? "enabled" : "disabled"}.`);
  } catch (error) {
    appendLog(error.message);
  }
});

lmStudioBaseUrl.addEventListener("change", async () => {
  try {
    await savePatch({ lmStudioBaseUrl: lmStudioBaseUrl.value.trim() }, "LM Studio URL updated.");
  } catch (error) {
    appendLog(error.message);
  }
});

lmStudioModel.addEventListener("change", async () => {
  try {
    await savePatch({ lmStudioModel: lmStudioModel.value.trim() }, "LM Studio model updated.");
  } catch (error) {
    appendLog(error.message);
  }
});

openRouterEnabled.addEventListener("change", async () => {
  try {
    await savePatch({ openRouterEnabled: openRouterEnabled.checked }, `OpenRouter polish ${openRouterEnabled.checked ? "enabled" : "disabled"}.`);
  } catch (error) {
    appendLog(error.message);
  }
});

openRouterApiKey.addEventListener("change", async () => {
  try {
    await savePatch({ openRouterApiKey: openRouterApiKey.value.trim() }, "OpenRouter API key updated.");
  } catch (error) {
    appendLog(error.message);
  }
});

openRouterBaseUrl.addEventListener("change", async () => {
  try {
    await savePatch({ openRouterBaseUrl: openRouterBaseUrl.value.trim() }, "OpenRouter base URL updated.");
  } catch (error) {
    appendLog(error.message);
  }
});

openRouterModel.addEventListener("change", async () => {
  try {
    await savePatch({ openRouterModel: openRouterModel.value }, `OpenRouter model set to ${openRouterModel.value}.`);
  } catch (error) {
    appendLog(error.message);
  }
});

refreshOpenRouterModels.addEventListener("click", async () => {
  try {
    await savePatch({
      openRouterApiKey: openRouterApiKey.value.trim(),
      openRouterBaseUrl: openRouterBaseUrl.value.trim()
    });
    const result = await window.localWhispr.getOpenRouterVoiceModels();
    setOpenRouterModels(result.models || []);
    appendLog(`Loaded ${(result.models || []).length} OpenRouter voice models.`);
  } catch (error) {
    appendLog(`OpenRouter model fetch failed: ${error.message}`);
  }
});

scanHardwareButton.addEventListener("click", async () => {
  try {
    const data = await window.localWhispr.scanHardware();
    renderHardware(data);
    appendLog("Hardware scan complete.");
  } catch (error) {
    appendLog(`Hardware scan failed: ${error.message}`);
  }
});

runBenchmarkButton.addEventListener("click", async () => {
  try {
    benchmarkOutput.textContent = "Running benchmark...";
    const result = await window.localWhispr.runBenchmark();
    if (result.cancelled) {
      benchmarkOutput.textContent = "Cancelled.";
      return;
    }
    benchmarkOutput.textContent = result.output || "No output";
    appendLog("Benchmark complete.");
  } catch (error) {
    benchmarkOutput.textContent = "Benchmark failed.";
    appendLog(`Benchmark failed: ${error.message}`);
  }
});

clearBenchmarkButton.addEventListener("click", () => {
  benchmarkOutput.textContent = "";
});

searchModelsButton.addEventListener("click", async () => {
  const query = modelSearchInput.value.trim();
  if (!query) {
    renderSearchResults([]);
    return;
  }

  try {
    modelSearchResults.innerHTML = "<li>Searching...</li>";
    const result = await window.localWhispr.searchAudioModels(query);
    renderSearchResults(result.results || []);
    appendLog(`Found ${result.results?.length || 0} Hugging Face models for '${query}'.`);
  } catch (error) {
    renderSearchResults([]);
    appendLog(`Model search failed: ${error.message}`);
  }
});

modeLocalButton.addEventListener("click", () => {
  setOnboardingSelection("whispercpp");
});

modeOpenRouterButton.addEventListener("click", () => {
  setOnboardingSelection("openrouter");
});

onboardingOpenRouterApiKey.addEventListener("input", () => {
  updateOnboardingUI();
});

onboardingContinue.addEventListener("click", async () => {
  try {
    await applyOnboardingChoice();
  } catch (error) {
    appendLog(`Quick Start failed: ${error.message}`);
  }
});

refreshStatus().catch((error) => appendLog(error.message));
window.localWhispr.scanHardware().then(renderHardware).catch(() => {});
renderWelcomeArt();
