const { app, BrowserWindow, ipcMain, globalShortcut, shell } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const APP_NAME = "PulseType";
const DEFAULT_MODEL_SIZE = "small.en";
const DEFAULT_HOTKEY = "CommandOrControl+Shift+Space";
const HF_BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

let mainWindow;
let isRecording = false;
let recorderProcess = null;
let currentRecordingFile = null;
let isTranscribing = false;

const configDir = app.getPath("userData");
const configPath = path.join(configDir, "config.json");
const modelDir = path.join(configDir, "models");

function logToUI(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:log", message);
  }
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
    lmStudioEnabled: false,
    lmStudioBaseUrl: "http://127.0.0.1:1234/v1",
    lmStudioModel: ""
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
  if (typeof patch.lmStudioEnabled === "boolean") {
    next.lmStudioEnabled = patch.lmStudioEnabled;
  }
  if (typeof patch.lmStudioBaseUrl === "string") {
    next.lmStudioBaseUrl = patch.lmStudioBaseUrl;
  }
  if (typeof patch.lmStudioModel === "string") {
    next.lmStudioModel = patch.lmStudioModel;
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

async function transcribe(audioPath) {
  const config = loadConfig();
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
          "You are a dictation post-processor. Return only the corrected transcription with punctuation and capitalization. Keep wording and language unchanged."
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
    return output.trim();
  } catch (error) {
    logToUI(`LM Studio polish skipped: ${error.message}`);
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function startRecording() {
  if (isRecording || isTranscribing) {
    return { isRecording, isTranscribing };
  }

  const tempPath = path.join(os.tmpdir(), `pulsetype-input-${Date.now()}.wav`);
  currentRecordingFile = tempPath;

  const args = ["-q", "-d", "-c", "1", "-r", "16000", "-b", "16", tempPath];
  recorderProcess = spawn("sox", args);
  isRecording = true;
  shell.beep();
  logToUI("Recording started...");

  recorderProcess.on("error", (err) => {
    logToUI(`Recording error: ${err.message}`);
    isRecording = false;
    recorderProcess = null;
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
  shell.beep();

  activeRecorder.kill("SIGINT");
  await waitForProcessExit(activeRecorder);

  try {
    logToUI("Transcribing...");
    const config = loadConfig();
    const text = await transcribe(currentRecordingFile);
    const finalText = await polishWithLmStudio(text, config);
    if (finalText) {
      await insertTextAtCursor(finalText);
      logToUI(`Inserted: ${finalText.slice(0, 120)}${finalText.length > 120 ? "..." : ""}`);
    } else {
      logToUI("No speech detected.");
    }
  } finally {
    if (currentRecordingFile) {
      await fsp.rm(currentRecordingFile, { force: true });
    }
    currentRecordingFile = null;
    isTranscribing = false;
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
    width: 560,
    height: 420,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: APP_NAME
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  app.setName(APP_NAME);
  createWindow();

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
      whisperInstalled: Boolean(findWhisperCli())
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
      registerShortcut(merged.hotkey);
    }

    return { ok: true, config: merged };
  });

  ipcMain.handle("app:downloadModel", async () => {
    const config = loadConfig();
    await ensureModelDownloaded(config.modelSize);
    return { ok: true };
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
