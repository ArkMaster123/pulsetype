# PulseType

Local-first macOS dictation app for creators who want a Wispr-like flow with private on-device transcription.

![PulseType icon](app/src/renderer/assets/pulsetype-icon.svg)

## Highlights

- Global shortcut dictation flow
- Local Whisper transcription (`whisper.cpp`)
- Siri-style animated desktop UI
- Optional LM Studio cleanup pass for punctuation/casing
- Benchmark runner for comparing local vs OpenAI-compatible ASR endpoints

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
