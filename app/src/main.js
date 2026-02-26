const { app, BrowserWindow, ipcMain, globalShortcut, shell, dialog, Tray, Menu, nativeImage } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const APP_NAME = "PulseType";
const DEFAULT_MODEL_SIZE = "base.en";
const DEFAULT_HOTKEY = "CommandOrControl+Shift+Space";
const HF_BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

let mainWindow;
let isRecording = false;
let recorderProcess = null;
let currentRecordingFile = null;
let isTranscribing = false;
let tray = null;
let trayRefreshMenu = () => {};
let trayPulseTimer = null;
let trayIcons = null;
let recordingMode = "file";
let streamTranscriptChunks = [];
let streamPartialText = "";

const configDir = app.getPath("userData");
const configPath = path.join(configDir, "config.json");
const modelDir = path.join(configDir, "models");

function logToUI(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:log", message);
  }
}

function sendTranscriptToUI(type, text) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:transcript", { type, text });
  }
}

function clearTrayPulse() {
  if (trayPulseTimer) {
    clearInterval(trayPulseTimer);
    trayPulseTimer = null;
  }
}

function updateTrayVisual(state) {
  if (!tray || !trayIcons) {
    return;
  }

  clearTrayPulse();

  if (state === "recording") {
    let frame = false;
    tray.setTitle("REC");
    tray.setImage(trayIcons.recordingA);
    trayPulseTimer = setInterval(() => {
      frame = !frame;
      tray.setImage(frame ? trayIcons.recordingB : trayIcons.recordingA);
    }, 360);
  } else if (state === "transcribing") {
    let frame = false;
    tray.setTitle("...");
    tray.setImage(trayIcons.transcribing);
    trayPulseTimer = setInterval(() => {
      frame = !frame;
      tray.setImage(frame ? trayIcons.idle : trayIcons.transcribing);
    }, 520);
  } else {
    tray.setTitle("");
    tray.setImage(trayIcons.idle);
  }

  trayRefreshMenu();
}

function ensureDirs() {
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(modelDir, { recursive: true });
}

function defaultConfig() {
  return {
    modelSize: DEFAULT_MODEL_SIZE,
    language: "en",
    hotkey: DEFAULT_HOTKEY,
    transcriptionProvider: "whispercpp",
    mlxModel: "mlx-community/whisper-large-v3-turbo",
    lmStudioEnabled: false,
    lmStudioBaseUrl: "http://127.0.0.1:1234/v1",
    lmStudioModel: "",
    openRouterEnabled: false,
    openRouterApiKey: "",
    openRouterBaseUrl: "https://openrouter.ai/api/v1",
    openRouterModel: "mistralai/voxtral-small-24b-2507"
  };
}

function loadConfig() {
  ensureDirs();
  if (!fs.existsSync(configPath)) {
    const config = defaultConfig();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return config;
  }

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    return { ...defaultConfig(), ...parsed };
  } catch {
    return defaultConfig();
  }
}

function saveConfig(config) {
  ensureDirs();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function sanitizeConfigPatch(patch) {
  const next = {};
  if (typeof patch.modelSize === "string") {
    next.modelSize = patch.modelSize;
  }
  if (typeof patch.language === "string") {
    next.language = patch.language;
  }
  if (typeof patch.hotkey === "string") {
    next.hotkey = patch.hotkey;
  }
  if (typeof patch.transcriptionProvider === "string") {
    next.transcriptionProvider = patch.transcriptionProvider;
  }
  if (typeof patch.mlxModel === "string") {
    next.mlxModel = patch.mlxModel;
  }
  if (typeof patch.lmStudioEnabled === "boolean") {
    next.lmStudioEnabled = patch.lmStudioEnabled;
  }
  if (typeof patch.lmStudioBaseUrl === "string") {
    next.lmStudioBaseUrl = patch.lmStudioBaseUrl;
  }
  if (typeof patch.lmStudioModel === "string") {
    next.lmStudioModel = patch.lmStudioModel;
  }
  if (typeof patch.openRouterEnabled === "boolean") {
    next.openRouterEnabled = patch.openRouterEnabled;
  }
  if (typeof patch.openRouterApiKey === "string") {
    next.openRouterApiKey = patch.openRouterApiKey;
  }
  if (typeof patch.openRouterBaseUrl === "string") {
    next.openRouterBaseUrl = patch.openRouterBaseUrl;
  }
  if (typeof patch.openRouterModel === "string") {
    next.openRouterModel = patch.openRouterModel;
  }
  return next;
}

function modelPath(modelSize) {
  return path.join(modelDir, `ggml-${modelSize}.bin`);
}

function registerShortcut(hotkey) {
  globalShortcut.unregisterAll();
  const ok = globalShortcut.register(hotkey, async () => {
    await toggleRecording("hotkey");
  });

  if (!ok) {
    logToUI(`Failed to register hotkey: ${hotkey}`);
  }

  return ok;
}

function copyToClipboard(text) {
  spawnSync("pbcopy", { input: text, encoding: "utf8" });
}

function readClipboard() {
  const result = spawnSync("pbpaste", { encoding: "utf8" });
  return result.status === 0 ? result.stdout : "";
}

function pasteAtCursor() {
  const script = 'tell application "System Events" to keystroke "v" using command down';
  const result = spawnSync("osascript", ["-e", script], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || "Failed to paste text at cursor");
  }
}

async function insertTextAtCursor(text) {
  if (!text.trim()) {
    return;
  }

  const previousClipboard = readClipboard();
  copyToClipboard(text);
  await new Promise((resolve) => setTimeout(resolve, 80));
  pasteAtCursor();
  await new Promise((resolve) => setTimeout(resolve, 80));
  copyToClipboard(previousClipboard);
}

function findWhisperCli() {
  const result = spawnSync("which", ["whisper-cli"], { encoding: "utf8" });
  if (result.status === 0) {
    return result.stdout.trim();
  }
  return null;
}

function findPython3() {
  const result = spawnSync("which", ["python3"], { encoding: "utf8" });
  if (result.status === 0) {
    return result.stdout.trim();
  }
  return null;
}

function runProcess(command, args, onStderr) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (onStderr) {
        onStderr(text);
      }
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr || `${command} exited with code ${code}`));
    });
  });
}

function runCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr || stdout || `${command} exited with code ${code}`));
    });
  });
}

async function ensureModelDownloaded(modelSize) {
  const target = modelPath(modelSize);
  if (fs.existsSync(target)) {
    return target;
  }

  logToUI(`Downloading model ${modelSize}...`);
  const url = `${HF_BASE}/ggml-${modelSize}.bin`;
  await runProcess("/usr/bin/curl", ["-L", "--progress-bar", "-o", target, url]);
  logToUI(`Model downloaded: ${target}`);
  return target;
}

async function transcribeWithWhisper(audioPath, config) {
  const whisperCli = findWhisperCli();

  if (!whisperCli) {
    throw new Error("whisper-cli is not installed. Run: brew install whisper-cpp");
  }

  const model = await ensureModelDownloaded(config.modelSize);
  const outBase = path.join(os.tmpdir(), `pulsetype-${Date.now()}`);

  await runProcess(
    whisperCli,
    [
      "-m",
      model,
      "-f",
      audioPath,
      "-l",
      config.language,
      "-nt",
      "-otxt",
      "-of",
      outBase,
      "-np"
    ],
    (line) => {
      if (line.trim()) {
        logToUI(line.trim());
      }
    }
  );

  const txtPath = `${outBase}.txt`;
  const text = await fsp.readFile(txtPath, "utf8");
  await fsp.rm(txtPath, { force: true });
  return text.trim();
}

async function transcribeWithMlx(audioPath, config) {
  const python3 = findPython3();
  if (!python3) {
    throw new Error("python3 is missing. Install Python 3.11+ for MLX transcription.");
  }

  const scriptPath = path.join(__dirname, "..", "scripts", "mlx_transcribe.py");
  const args = [scriptPath, "--audio", audioPath, "--model", config.mlxModel];
  if (config.language && config.language !== "auto") {
    args.push("--language", config.language);
  }

  logToUI(`MLX model: ${config.mlxModel}`);
  const { stdout } = await runCapture(python3, args);
  const payload = JSON.parse(stdout);
  return (payload.text || "").trim();
}

async function transcribe(audioPath, config) {
  if (config.transcriptionProvider === "mlx") {
    try {
      return await transcribeWithMlx(audioPath, config);
    } catch (error) {
      logToUI(`MLX failed, fallback to whisper.cpp: ${error.message}`);
      return transcribeWithWhisper(audioPath, config);
    }
  }

  return transcribeWithWhisper(audioPath, config);
}

async function polishWithLmStudio(text, config) {
  if (!config.lmStudioEnabled || !text.trim()) {
    return text;
  }

  const baseUrl = (config.lmStudioBaseUrl || "").replace(/\/$/, "");
  if (!baseUrl) {
    logToUI("LM Studio enabled but base URL is empty. Skipping polish.");
    return text;
  }

  const model = config.lmStudioModel || undefined;
  const payload = {
    model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You are a dictation post-processor. Return only the corrected transcription with punctuation and capitalization. Do not paraphrase, summarize, translate, add, or remove words. If uncertain, return the original text unchanged."
      },
      {
        role: "user",
        content: text
      }
    ]
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    logToUI("Polishing transcript with LM Studio...");
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LM Studio error ${response.status}: ${body.slice(0, 120)}`);
    }

    const json = await response.json();
    const output = json?.choices?.[0]?.message?.content;
    if (!output || !output.trim()) {
      return text;
    }

    const polished = output.trim();
    const similarity = tokenSimilarity(text, polished);
    if (similarity < 0.72) {
      logToUI(`LM Studio output diverged from raw transcript (similarity ${similarity.toFixed(2)}). Keeping raw transcript.`);
      return text;
    }

    return polished;
  } catch (error) {
    logToUI(`LM Studio polish skipped: ${error.message}`);
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function polishWithOpenRouter(text, config) {
  if (!config.openRouterEnabled || !text.trim()) {
    return text;
  }

  const apiKey = (config.openRouterApiKey || "").trim();
  const baseUrl = (config.openRouterBaseUrl || "").replace(/\/$/, "");
  const model = (config.openRouterModel || "").trim();

  if (!apiKey) {
    logToUI("OpenRouter enabled but API key is missing. Skipping cloud polish.");
    return text;
  }
  if (!baseUrl || !model) {
    logToUI("OpenRouter enabled but base URL or model is missing. Skipping cloud polish.");
    return text;
  }

  const payload = {
    model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You are a dictation post-processor. Return only the corrected transcription with punctuation and capitalization. Do not paraphrase, summarize, translate, add, or remove words. If uncertain, return the original text unchanged."
      },
      {
        role: "user",
        content: text
      }
    ]
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    logToUI(`Polishing transcript with OpenRouter (${model})...`);
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenRouter error ${response.status}: ${body.slice(0, 140)}`);
    }

    const json = await response.json();
    const output = json?.choices?.[0]?.message?.content;
    if (!output || !output.trim()) {
      return text;
    }

    const polished = output.trim();
    const similarity = tokenSimilarity(text, polished);
    if (similarity < 0.72) {
      logToUI(`OpenRouter output diverged from raw transcript (similarity ${similarity.toFixed(2)}). Keeping raw transcript.`);
      return text;
    }

    return polished;
  } catch (error) {
    logToUI(`OpenRouter polish skipped: ${error.message}`);
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

function tokenizeForSimilarity(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function tokenSimilarity(a, b) {
  const aTokens = new Set(tokenizeForSimilarity(a));
  const bTokens = new Set(tokenizeForSimilarity(b));
  if (!aTokens.size && !bTokens.size) {
    return 1;
  }
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      overlap += 1;
    }
  }
  const union = new Set([...aTokens, ...bTokens]).size;
  if (!union) {
    return 1;
  }
  return overlap / union;
}

function normalizeStreamLine(input) {
  return input
    .replace(/\x1B\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\[[0-9:.]+\s*-->\s*[0-9:.]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildStreamFinalText() {
  const unique = [];
  for (const chunk of streamTranscriptChunks) {
    if (!chunk) {
      continue;
    }
    if (unique.length === 0 || unique[unique.length - 1] !== chunk) {
      unique.push(chunk);
    }
  }

  const merged = unique.join(" ").replace(/\s+/g, " ").trim();
  return merged || streamPartialText || "";
}

async function startWhisperStreamRecording(config) {
  const whisperCli = findWhisperCli();
  if (!whisperCli) {
    throw new Error("whisper-cli is not installed. Run: brew install whisper-cpp");
  }

  const model = await ensureModelDownloaded(config.modelSize);
  const lang = config.language && config.language !== "auto" ? config.language : "en";
  const threads = String(Math.max(2, Math.min(8, Math.floor((os.cpus()?.length || 4) / 2))));

  streamTranscriptChunks = [];
  streamPartialText = "";
  sendTranscriptToUI("clear", "");

  const args = [
    "-m",
    model,
    "-l",
    lang,
    "-t",
    threads,
    "--step",
    "1800",
    "--length",
    "7000",
    "--keep",
    "250",
    "-mt",
    "24"
  ];

  recorderProcess = spawn("whisper-stream", args);
  recordingMode = "stream";
  isRecording = true;
  updateTrayVisual("recording");
  shell.beep();
  logToUI(`Streaming transcription started (${config.modelSize}, ${lang}).`);

  recorderProcess.stdout.on("data", (chunk) => {
    const lines = chunk
      .toString()
      .split(/\r?\n/)
      .map(normalizeStreamLine)
      .filter(Boolean);

    for (const line of lines) {
      if (line.length < 2) {
        continue;
      }
      streamPartialText = line;
      streamTranscriptChunks.push(line);
      sendTranscriptToUI("partial", line);
    }
  });

  recorderProcess.on("error", (err) => {
    logToUI(`Stream recording error: ${err.message}`);
    isRecording = false;
    recorderProcess = null;
    updateTrayVisual("idle");
  });

  return { isRecording, isTranscribing };
}

async function startRecording() {
  if (isRecording || isTranscribing) {
    return { isRecording, isTranscribing };
  }

  const config = loadConfig();
  if (config.transcriptionProvider === "whispercpp") {
    return startWhisperStreamRecording(config);
  }

  sendTranscriptToUI("clear", "");

  const tempPath = path.join(os.tmpdir(), `pulsetype-input-${Date.now()}.wav`);
  currentRecordingFile = tempPath;

  const args = ["-q", "-d", "-c", "1", "-r", "16000", "-b", "16", tempPath];
  recorderProcess = spawn("sox", args);
  recordingMode = "file";
  isRecording = true;
  updateTrayVisual("recording");
  shell.beep();
  logToUI("Recording started...");

  recorderProcess.on("error", (err) => {
    logToUI(`Recording error: ${err.message}`);
    isRecording = false;
    recorderProcess = null;
    updateTrayVisual("idle");
  });

  return { isRecording, isTranscribing };
}

function waitForProcessExit(child) {
  return new Promise((resolve) => {
    child.once("close", () => resolve());
  });
}

async function stopRecording() {
  if (!isRecording || !recorderProcess) {
    return { isRecording, isTranscribing };
  }

  const activeRecorder = recorderProcess;
  recorderProcess = null;
  isRecording = false;
  isTranscribing = true;
  updateTrayVisual("transcribing");
  shell.beep();

  activeRecorder.kill("SIGINT");
  await waitForProcessExit(activeRecorder);

  try {
    logToUI(recordingMode === "stream" ? "Finalizing transcript..." : "Transcribing...");
    const config = loadConfig();
    let text = "";
    const t1 = Date.now();
    if (recordingMode === "stream") {
      text = buildStreamFinalText();
    } else {
      text = await transcribe(currentRecordingFile, config);
    }
    logToUI(`Raw transcript: ${text.slice(0, 120)}${text.length > 120 ? "..." : ""}`);
    sendTranscriptToUI("final", text);
    const transcribeMs = Date.now() - t1;

    const t2 = Date.now();
    let finalText = text;
    if (config.lmStudioEnabled) {
      finalText = await polishWithLmStudio(finalText, config);
    } else if (config.openRouterEnabled) {
      finalText = await polishWithOpenRouter(finalText, config);
    }
    const polishMs = Date.now() - t2;

    if (finalText) {
      const t3 = Date.now();
      await insertTextAtCursor(finalText);
      const pasteMs = Date.now() - t3;
      logToUI(`Inserted: ${finalText.slice(0, 120)}${finalText.length > 120 ? "..." : ""}`);
      logToUI(`Speed: transcribe ${transcribeMs} ms, polish ${polishMs} ms, paste ${pasteMs} ms`);
    } else {
      logToUI("No speech detected.");
      logToUI(`Speed: transcribe ${transcribeMs} ms, polish ${polishMs} ms`);
    }
  } finally {
    if (recordingMode === "file" && currentRecordingFile) {
      await fsp.rm(currentRecordingFile, { force: true });
    }
    currentRecordingFile = null;
    recordingMode = "file";
    streamTranscriptChunks = [];
    streamPartialText = "";
    isTranscribing = false;
    updateTrayVisual("idle");
  }

  return { isRecording, isTranscribing };
}

async function toggleRecording(source = "ui") {
  logToUI(`Trigger: ${source}`);
  if (isRecording) {
    return stopRecording();
  }
  return startRecording();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: APP_NAME
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.on("close", (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  if (tray) {
    return;
  }

  const loadTrayIcon = (fileName) => {
    const iconPath = path.join(__dirname, "renderer", "assets", fileName);
    let icon = nativeImage.createFromPath(iconPath);
    icon = icon.resize({ width: 18, height: 18 });
    icon.setTemplateImage(true);
    return icon;
  };

  trayIcons = {
    idle: loadTrayIcon("pulsetype-tray-template.png"),
    recordingA: loadTrayIcon("pulsetype-tray-recording-a-template.png"),
    recordingB: loadTrayIcon("pulsetype-tray-recording-b-template.png"),
    transcribing: loadTrayIcon("pulsetype-tray-transcribing-template.png")
  };

  tray = new Tray(trayIcons.idle);
  tray.setToolTip("PulseType");

  trayRefreshMenu = () => {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: mainWindow && mainWindow.isVisible() ? "Hide PulseType" : "Show PulseType",
        click: () => {
          if (!mainWindow) {
            return;
          }
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      {
        label: isRecording ? "Stop Dictation" : "Start Dictation",
        click: async () => {
          await toggleRecording("tray");
          trayRefreshMenu();
        }
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          app.isQuiting = true;
          app.quit();
        }
      }
    ]);
    tray.setContextMenu(contextMenu);
  };

  tray.on("click", () => {
    if (!mainWindow) {
      return;
    }
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  updateTrayVisual("idle");
}

app.whenReady().then(() => {
  app.setName(APP_NAME);
  createWindow();
  createTray();

  const config = loadConfig();
  registerShortcut(config.hotkey);

  ipcMain.handle("app:getStatus", async () => {
    const currentConfig = loadConfig();
    return {
      isRecording,
      isTranscribing,
      config: currentConfig,
      modelExists: fs.existsSync(modelPath(currentConfig.modelSize)),
      modelPath: modelPath(currentConfig.modelSize),
      whisperInstalled: Boolean(findWhisperCli()),
      pythonInstalled: Boolean(findPython3())
    };
  });

  ipcMain.handle("app:toggleRecording", async () => toggleRecording("ui"));

  ipcMain.handle("app:setModel", async (_event, modelSize) => {
    const config = loadConfig();
    config.modelSize = modelSize;
    saveConfig(config);
    return { ok: true };
  });

  ipcMain.handle("app:setConfig", async (_event, patch) => {
    const config = loadConfig();
    const merged = { ...config, ...sanitizeConfigPatch(patch || {}) };
    saveConfig(merged);

    if (patch && typeof patch.hotkey === "string") {
      const ok = registerShortcut(merged.hotkey);
      if (!ok) {
        return { ok: false, error: `Could not register shortcut: ${merged.hotkey}`, config: merged };
      }
    }

    return { ok: true, config: merged };
  });

  ipcMain.handle("app:scanHardware", async () => {
    const memTotal = os.totalmem();
    const memFree = os.freemem();
    const cpu = os.cpus()[0]?.model || "Unknown";
    const disk = spawnSync("df", ["-k", "/"], { encoding: "utf8" });
    const lines = disk.stdout.trim().split("\n");
    const columns = lines[lines.length - 1]?.split(/\s+/) || [];
    const totalKB = Number(columns[1] || 0);
    const availKB = Number(columns[3] || 0);
    const modelSize = spawnSync("du", ["-sk", modelDir], { encoding: "utf8" });
    const modelKB = Number((modelSize.stdout || "0").split(/\s+/)[0] || 0);

    return {
      cpu,
      platform: `${os.platform()} ${os.arch()}`,
      memoryTotalGB: (memTotal / 1024 / 1024 / 1024).toFixed(1),
      memoryFreeGB: (memFree / 1024 / 1024 / 1024).toFixed(1),
      diskTotalGB: (totalKB / 1024 / 1024).toFixed(1),
      diskFreeGB: (availKB / 1024 / 1024).toFixed(1),
      modelsOnDiskGB: (modelKB / 1024 / 1024).toFixed(2)
    };
  });

  ipcMain.handle("app:searchAudioModels", async (_event, query) => {
    const q = (query || "").trim();
    if (!q) {
      return { results: [] };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const url = `https://huggingface.co/api/models?pipeline_tag=automatic-speech-recognition&search=${encodeURIComponent(q)}&sort=downloads&direction=-1&limit=12`;
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Hugging Face API error ${response.status}`);
      }

      const data = await response.json();
      const results = (Array.isArray(data) ? data : []).map((model) => ({
        id: model.id,
        likes: model.likes || 0,
        downloads: model.downloads || 0,
        updatedAt: model.lastModified || "",
        tags: (model.tags || []).slice(0, 4)
      }));

      return { results };
    } finally {
      clearTimeout(timeout);
    }
  });

  ipcMain.handle("app:runBenchmark", async () => {
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: "Choose audio file for benchmark",
      properties: ["openFile"],
      filters: [{ name: "Audio", extensions: ["wav", "mp3", "m4a", "flac"] }]
    });

    if (picked.canceled || !picked.filePaths.length) {
      return { cancelled: true };
    }

    const config = loadConfig();
    const scriptPath = path.join(__dirname, "..", "scripts", "benchmark-stt.mjs");
    const args = [scriptPath, "--audio", picked.filePaths[0], "--lang", config.language || "en"];

    if (config.lmStudioModel && config.lmStudioBaseUrl) {
      args.push("--openai-base-url", config.lmStudioBaseUrl, "--openai-models", config.lmStudioModel);
    }

    const { stdout, stderr } = await runCapture(process.execPath, args);
    return {
      cancelled: false,
      output: `${stdout}${stderr ? `\n${stderr}` : ""}`.trim()
    };
  });

  ipcMain.handle("app:getOpenRouterVoiceModels", async () => {
    const config = loadConfig();
    const baseUrl = (config.openRouterBaseUrl || "https://openrouter.ai/api/v1").replace(/\/$/, "");
    const apiKey = (config.openRouterApiKey || "").trim();

    const headers = { "Content-Type": "application/json" };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await fetch(`${baseUrl}/models`, { headers });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenRouter models request failed (${response.status}): ${body.slice(0, 140)}`);
    }

    const json = await response.json();
    const all = Array.isArray(json?.data) ? json.data : [];
    const voiceKeywords = /(voice|audio|speech|asr|transcribe|whisper|voxtral)/i;
    const filtered = all
      .filter((model) => {
        const haystack = `${model.id || ""} ${model.name || ""} ${(model.description || "")}`;
        return voiceKeywords.test(haystack);
      })
      .map((model) => ({
        id: model.id,
        name: model.name || model.id,
        context_length: model.context_length || null,
        pricing: model.pricing || null
      }));

    return { models: filtered };
  });

  ipcMain.handle("app:downloadModel", async () => {
    const config = loadConfig();
    await ensureModelDownloaded(config.modelSize);
    return { ok: true };
  });
});

app.on("will-quit", () => {
  clearTrayPulse();
  globalShortcut.unregisterAll();
});
