# PulseType (Electron)

Local-first macOS dictation app with a global shortcut:

- Hit `Command+Shift+Space` to start recording
- Hit it again to stop, transcribe with `whisper-cli`, and paste text at cursor
- Optional LM Studio post-processing for punctuation/casing cleanup

## Requirements

```bash
brew install whisper-cpp sox
```

## Run

```bash
npm install
npm start
```

## Chinese setup

- Use multilingual models (`tiny`, `base`, `small`, `medium`) in the app.
- Set language to `Chinese (Mandarin)` (`zh`).
- For quality/speed, start with `base` then test `small` if needed.

## Quick local benchmark (your own audio)

```bash
./scripts/benchmark-whisper.sh /path/to/mandarin-audio.wav zh
```

This compares `tiny`, `base`, and `small` wall-clock speed on your machine and prints a preview transcript.

## Permissions (macOS)

1. Microphone: allow `PulseType` / `Electron`
2. Accessibility: allow Terminal (for dev) or built app to let it paste into other apps

## Build app

```bash
npm run dist
```

The DMG lands in `dist/`.

## Model location

Models are downloaded to:

`~/Library/Application Support/PulseType/models`
