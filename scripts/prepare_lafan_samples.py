#!/usr/bin/env python3
"""Extract and trim representative LAFAN1 clips for bundled web samples.

Source: Ubisoft La Forge Animation Dataset (LAFAN1), non-commercial license.
https://github.com/ubisoft/ubisoft-laforge-animation-dataset

Requires the dataset zip at LAFAN1_ZIP (default: /tmp/lafan1-dataset/lafan1/lafan1.zip).
Clips are trimmed to keep the static bundle small while preserving recognizable motion.

Usage: python3 scripts/prepare_lafan_samples.py
"""

import os
import zipfile

LAFAN1_ZIP = os.environ.get(
    "LAFAN1_ZIP",
    os.path.join("/tmp", "lafan1-dataset", "lafan1", "lafan1.zip"),
)
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "sample_motions")

# output name -> (source bvh in zip, start frame, frame count)
SAMPLES = {
    "walk.bvh": ("walk1_subject1.bvh", 0, 240),
    "run.bvh": ("run1_subject5.bvh", 0, 240),
    "dance.bvh": ("dance1_subject1.bvh", 0, 240),
    "fall_getup.bvh": ("fallAndGetUp3_subject1.bvh", 0, 360),
    "jumps.bvh": ("jumps1_subject1.bvh", 0, 240),
}


def trim_bvh(text: str, start: int, count: int) -> str:
    lines = text.splitlines()
    motion_i = next(i for i, line in enumerate(lines) if line.strip() == "MOTION")
    frames_line = lines[motion_i + 1]
    frame_time_line = lines[motion_i + 2]
    data_lines = lines[motion_i + 3 :]

    total = int(frames_line.split(":")[1].strip())
    if start + count > total:
        raise ValueError(f"trim range {start}+{count} exceeds {total} frames")

    out = lines[: motion_i + 1] + [f"Frames: {count}", frame_time_line] + data_lines[start : start + count]
    return "\n".join(out) + "\n"


def main():
    if not os.path.isfile(LAFAN1_ZIP):
        raise SystemExit(
            f"LAFAN1 zip not found at {LAFAN1_ZIP}\n"
            "Clone https://github.com/ubisoft/ubisoft-laforge-animation-dataset "
            "(git lfs) and set LAFAN1_ZIP."
        )

    os.makedirs(OUT_DIR, exist_ok=True)
    with zipfile.ZipFile(LAFAN1_ZIP) as zf:
        for out_name, (src_name, start, count) in SAMPLES.items():
            raw = zf.read(src_name).decode("utf-8")
            trimmed = trim_bvh(raw, start, count)
            path = os.path.join(OUT_DIR, out_name)
            with open(path, "w", encoding="utf-8") as f:
                f.write(trimmed)
            kb = os.path.getsize(path) / 1024
            print(f"wrote {path}  ({count} frames from {src_name}, {kb:.0f} KiB)")

    # Remove legacy procedural samples if present.
    for legacy in ("wave.bvh", "backflip.bvh", "sideflip.bvh"):
        legacy_path = os.path.join(OUT_DIR, legacy)
        if os.path.isfile(legacy_path):
            os.remove(legacy_path)
            print(f"removed legacy {legacy_path}")


if __name__ == "__main__":
    main()
