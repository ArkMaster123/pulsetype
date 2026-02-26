#!/usr/bin/env python3

import argparse
import json
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcribe audio with mlx-whisper")
    parser.add_argument("--audio", required=True, help="Path to audio file")
    parser.add_argument("--model", required=True, help="MLX model id")
    parser.add_argument(
        "--language", default=None, help="Language code (en, zh, fr, etc)"
    )
    args = parser.parse_args()

    try:
        import mlx_whisper  # type: ignore
    except Exception as exc:
        raise RuntimeError(
            "mlx-whisper is not installed. Install with: python3 -m pip install mlx-whisper"
        ) from exc

    options = {
        "path_or_hf_repo": args.model,
    }
    if args.language and args.language != "auto":
        options["language"] = args.language

    result = mlx_whisper.transcribe(args.audio, **options)
    text = ""
    if isinstance(result, dict):
        text = str(result.get("text", ""))

    sys.stdout.write(json.dumps({"text": text}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
