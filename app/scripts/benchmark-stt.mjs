#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const HF_BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
const DEFAULT_WHISPER_MODELS = ["tiny", "base", "small"];

function argValue(flag, fallback = "") {
  const i = process.argv.indexOf(flag);
  if (i === -1 || i + 1 >= process.argv.length) {
    return fallback;
  }
  return process.argv[i + 1];
}

function parseCsvFlag(flag, fallback) {
  const value = argValue(flag, "");
  if (!value) {
    return fallback;
  }
  return value.split(",").map((x) => x.trim()).filter(Boolean);
}

function usage() {
  console.log(`
Usage:
  node scripts/benchmark-stt.mjs --audio /path/to/file.wav [--lang en]
    [--whisper-models tiny,base,small]
    [--openai-base-url http://127.0.0.1:1234/v1 --openai-models qwen3-asr-0.6b,voxtral-mini-transcribe]

Notes:
  - Whisper models run locally via whisper-cli
  - OpenAI-compatible models are tested via /audio/transcriptions endpoint
`);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || `${command} exited with code ${code}`));
      }
    });
  });
}

function toMs(startNs, endNs) {
  return Number(endNs - startNs) / 1_000_000;
}

function truncate(text, max = 72) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) {
    return clean;
  }
  return `${clean.slice(0, max - 3)}...`;
}

async function ensureWhisperModel(modelName, modelsDir) {
  const file = path.join(modelsDir, `ggml-${modelName}.bin`);
  try {
    await fs.access(file);
    return file;
  } catch {
    await fs.mkdir(modelsDir, { recursive: true });
    const url = `${HF_BASE}/ggml-${modelName}.bin`;
    console.log(`Downloading ${modelName} model...`);
    await run("/usr/bin/curl", ["-L", "--progress-bar", "-o", file, url]);
    return file;
  }
}

async function benchmarkWhisper(audioPath, lang, modelName, modelsDir) {
  const outBase = path.join(os.tmpdir(), `stt-bench-${modelName}-${Date.now()}`);
  const modelPath = await ensureWhisperModel(modelName, modelsDir);

  const start = process.hrtime.bigint();
  await run("whisper-cli", ["-m", modelPath, "-f", audioPath, "-l", lang, "-nt", "-otxt", "-of", outBase, "-np"]);
  const end = process.hrtime.bigint();

  const textPath = `${outBase}.txt`;
  const text = await fs.readFile(textPath, "utf8");
  await fs.rm(textPath, { force: true });

  return {
    engine: `whisper:${modelName}`,
    ms: toMs(start, end),
    text: text.trim(),
    ok: true
  };
}

async function benchmarkOpenAICompatible(audioPath, lang, baseUrl, modelName) {
  const start = process.hrtime.bigint();
  const audio = await fs.readFile(audioPath);
  const form = new FormData();
  form.append("model", modelName);
  if (lang && lang !== "auto") {
    form.append("language", lang);
  }
  form.append("response_format", "json");
  form.append("file", new Blob([audio]), path.basename(audioPath));

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
    method: "POST",
    body: form
  });
  const end = process.hrtime.bigint();

  if (!res.ok) {
    const body = await res.text();
    return {
      engine: `openai:${modelName}`,
      ms: toMs(start, end),
      text: `ERROR ${res.status}: ${truncate(body, 120)}`,
      ok: false
    };
  }

  const json = await res.json();
  return {
    engine: `openai:${modelName}`,
    ms: toMs(start, end),
    text: (json?.text || "").trim(),
    ok: true
  };
}

function printResults(results) {
  console.log("\nResults");
  console.log("-".repeat(108));
  console.log(`${"Engine".padEnd(36)}${"Latency(ms)".padEnd(14)}Transcript`);
  console.log("-".repeat(108));
  for (const row of results) {
    console.log(`${row.engine.padEnd(36)}${row.ms.toFixed(1).padEnd(14)}${truncate(row.text, 84)}`);
  }
  console.log("-".repeat(108));
}

async function main() {
  const audioPath = argValue("--audio");
  if (!audioPath) {
    usage();
    process.exit(1);
  }

  const lang = argValue("--lang", "en");
  const whisperModels = parseCsvFlag("--whisper-models", DEFAULT_WHISPER_MODELS);
  const openaiModels = parseCsvFlag("--openai-models", []);
  const openaiBaseUrl = argValue("--openai-base-url", "");
  const modelsDir = path.join(process.env.HOME || "", "Library/Application Support/PulseType/models");
  const results = [];

  for (const model of whisperModels) {
    try {
      const row = await benchmarkWhisper(audioPath, lang, model, modelsDir);
      results.push(row);
    } catch (error) {
      results.push({
        engine: `whisper:${model}`,
        ms: 0,
        text: `ERROR: ${error.message}`,
        ok: false
      });
    }
  }

  if (openaiModels.length > 0 && openaiBaseUrl) {
    for (const model of openaiModels) {
      try {
        const row = await benchmarkOpenAICompatible(audioPath, lang, openaiBaseUrl, model);
        results.push(row);
      } catch (error) {
        results.push({
          engine: `openai:${model}`,
          ms: 0,
          text: `ERROR: ${error.message}`,
          ok: false
        });
      }
    }
  }

  printResults(results);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
