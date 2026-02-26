#!/usr/bin/env bash
set -euo pipefail

if ! command -v whisper-cli >/dev/null 2>&1; then
  echo "whisper-cli not found. Install with: brew install whisper-cpp"
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 /path/to/audio.wav [language]"
  echo "Example: $0 ~/Desktop/mandarin-test.wav zh"
  exit 1
fi

AUDIO_FILE="$1"
LANGUAGE="${2:-zh}"
APP_SUPPORT="$HOME/Library/Application Support/PulseType"
MODELS_DIR="$APP_SUPPORT/models"
TMP_DIR="$(mktemp -d)"
MODELS=("tiny" "base" "small")

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$MODELS_DIR"

download_model_if_missing() {
  local model="$1"
  local target="$MODELS_DIR/ggml-${model}.bin"
  if [[ -f "$target" ]]; then
    return
  fi
  echo "Downloading $model ..."
  /usr/bin/curl -L --progress-bar -o "$target" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin"
}

echo "Benchmarking file: $AUDIO_FILE"
echo "Language: $LANGUAGE"
printf "\n%-8s | %-10s | %-22s\n" "Model" "Wall Time" "Transcript (first 80 chars)"
printf "%-8s-+-%-10s-+-%-22s\n" "--------" "----------" "----------------------"

for model in "${MODELS[@]}"; do
  download_model_if_missing "$model"
  model_path="$MODELS_DIR/ggml-${model}.bin"
  out_base="$TMP_DIR/${model}"

  wall=$(/usr/bin/time -f "%e" whisper-cli -m "$model_path" -f "$AUDIO_FILE" -l "$LANGUAGE" -nt -otxt -of "$out_base" -np 2>&1 >/dev/null)
  text=""
  if [[ -f "${out_base}.txt" ]]; then
    text="$(tr '\n' ' ' < "${out_base}.txt")"
  fi
  preview="${text:0:80}"
  printf "%-8s | %-10ss | %-22s\n" "$model" "$wall" "$preview"
done

echo
echo "Tip: For Mandarin, usually choose base/small over tiny unless you need max speed."
