#!/usr/bin/env python3

import argparse
import json
import math
import sys

from faster_whisper import WhisperModel


def clamp(value, minimum, maximum):
    return max(minimum, min(maximum, value))


def build_parser():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio-path", required=True)
    parser.add_argument("--model", default="medium")
    return parser


def confidence_from_avg_logprob(avg_logprob):
    try:
        return clamp(math.exp(avg_logprob), 0.0, 1.0)
    except Exception:
        return 0.0


def main():
    args = build_parser().parse_args()
    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    segments, info = model.transcribe(args.audio_path, beam_size=1, vad_filter=True)

    transcript_parts = []
    logprobs = []
    segment_count = 0

    for segment in segments:
      segment_count += 1
      text = (segment.text or "").strip()
      if text:
          transcript_parts.append(text)
      if getattr(segment, "avg_logprob", None) is not None:
          logprobs.append(segment.avg_logprob)

    transcript = " ".join(part for part in transcript_parts if part).strip()
    avg_logprob = sum(logprobs) / len(logprobs) if logprobs else -2.0
    confidence = confidence_from_avg_logprob(avg_logprob)

    payload = {
        "transcript": transcript,
        "confidence": confidence,
        "language": getattr(info, "language", ""),
        "segmentCount": segment_count,
        "warnings": [],
    }

    sys.stdout.write(json.dumps(payload))


if __name__ == "__main__":
    main()
