#!/usr/bin/env python3
"""Trim + downsample raw Labrador mocap BVH into bundled quadruped samples.

Source: Tencent Robotics X "Lifelike Agility and Play" dataset (MIT License),
``data/raw_mocap_data/*.bvh`` — real Labrador retriever motion capture at 120 fps.
    https://github.com/Tencent-RoboticsX/lifelike-agility-and-play

This mirrors ``scripts/prepare_lafan_samples.py``: it does not commit the full
dataset, only short clips downsampled to 30 fps for the in-app sample list. Point
``--raw`` at a local checkout of the dataset's ``raw_mocap_data`` directory.

Usage:
    python3 scripts/prepare_dog_samples.py --raw /path/to/raw_mocap_data
"""

import argparse
import os

HERE = os.path.dirname(__file__)
OUT_DIR = os.path.join(HERE, "..", "public", "sample_motions")
DST_FPS = 30

# (source file, start_sec, duration_sec, output name)
CLIPS = [
    ("dog_quad_walkrun_007.bvh", 0.0, 6.5, "dog_walk.bvh"),
    ("dog_quad_run_002.bvh", 4.0, 7.0, "dog_run.bvh"),
    ("dog_idle_002.bvh", 1.0, 6.0, "dog_idle.bvh"),
]


def split_hierarchy(text: str):
    """Return (hierarchy_text, src_fps, data_lines)."""
    lines = text.splitlines()
    motion_i = next(i for i, l in enumerate(lines) if l.strip().startswith("MOTION"))
    hierarchy = "\n".join(lines[:motion_i])
    frame_time = None
    data_start = None
    for i in range(motion_i, len(lines)):
        s = lines[i].strip()
        if s.startswith("Frame Time:"):
            frame_time = float(s.split(":", 1)[1])
            data_start = i + 1
            break
    if frame_time is None or frame_time <= 0:
        raise SystemExit("could not find Frame Time")
    data = [l for l in lines[data_start:] if l.strip()]
    return hierarchy, round(1.0 / frame_time), data


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default="/tmp/dogbvh", help="dir with raw_mocap_data *.bvh")
    args = ap.parse_args()
    os.makedirs(OUT_DIR, exist_ok=True)

    for src, start_s, dur_s, out_name in CLIPS:
        path = os.path.join(args.raw, src)
        if not os.path.exists(path):
            print(f"SKIP {out_name}: missing {path}")
            continue
        hierarchy, src_fps, data = split_hierarchy(open(path, encoding="utf-8").read())
        step = max(1, round(src_fps / DST_FPS))
        i0 = int(start_s * src_fps)
        i1 = min(len(data), int((start_s + dur_s) * src_fps))
        frames = data[i0:i1:step]
        out = (
            hierarchy
            + f"\nMOTION\nFrames: {len(frames)}\n"
            + f"Frame Time: {1.0 / DST_FPS:.8f}\n"
            + "\n".join(frames)
            + "\n"
        )
        dst = os.path.join(OUT_DIR, out_name)
        open(dst, "w", encoding="utf-8").write(out)
        print(f"wrote {out_name}: {len(frames)} frames @ {DST_FPS} fps ({len(out)//1024} KiB)")


if __name__ == "__main__":
    main()
