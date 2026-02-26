# PulseType

Local-first macOS dictation app for creators who want a Wispr-like flow with private on-device transcription.

![PulseType icon](app/src/renderer/assets/pulsetype-icon.svg)

## Highlights

- Global shortcut dictation flow
- Live streaming transcript textbox while dictating (`whisper-stream`)
- Local Whisper transcription (`whisper.cpp`) plus optional MLX engine
- Menu bar tray icon with recording/transcribing state animation
- Quick Start onboarding with Local vs OpenRouter choice and latency guidance
- Optional LM Studio or OpenRouter cleanup pass for punctuation/casing
- Hugging Face ASR model search, hardware scan, and benchmark runner

## Project layout

- `app/` Electron desktop app
- `docs/` notes and references
- `references/` cloned OSS research repos (git-ignored)

## Quickstart

```bash
cd app
brew install whisper-cpp sox
npm install
npm start
```

Optional MLX runtime:

```bash
python3 -m pip install mlx-whisper
```

## Packaging

```bash
cd app
npm run dist
```

## Benchmark

```bash
cd app
npm run bench:stt -- --audio /path/to/audio.wav --lang en
```
