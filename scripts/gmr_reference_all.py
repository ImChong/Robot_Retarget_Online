#!/usr/bin/env python3
"""Generate GMR parity fixtures for every BVH-selectable robot.

Usage:
  GMR_ROOT=/tmp/gmr python3 scripts/gmr_reference_all.py [--max-frames 120]

Writes tests/fixtures/gmr_parity/walk_<robot_id>.json
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BVH = ROOT / "public" / "sample_motions" / "walk.bvh"
OUT_DIR = ROOT / "tests" / "fixtures" / "gmr_parity"

# Must match GMR tgt_robot ids (params.py ROBOT_XML_DICT keys with bvh_lafan1).
BVH_ROBOTS = [
    "unitree_g1",
    "unitree_g1_with_hands",
    "booster_t1_29dof",
    "stanford_toddy",
    "fourier_n1",
    "engineai_pm01",
    "pal_talos",
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-frames", type=int, default=120, help="0 = full clip")
    args = ap.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    script = ROOT / "scripts" / "gmr_reference.py"
    for robot in BVH_ROBOTS:
        out = OUT_DIR / f"walk_{robot}.json"
        cmd = [sys.executable, str(script), str(BVH), robot, str(out)]
        if args.max_frames > 0:
            cmd.extend(["--max-frames", str(args.max_frames)])
        print(f"=== {robot} -> {out.name} ===", file=sys.stderr)
        subprocess.run(cmd, check=True)


if __name__ == "__main__":
    main()
