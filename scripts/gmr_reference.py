#!/usr/bin/env python3
"""Run the ORIGINAL GMR pipeline on a BVH file and dump reference outputs
(frame-0 preprocessed targets + per-frame qpos) for parity testing against
the web engine.

Requires a local GMR clone (default /tmp/gmr) with Python deps installed.

Usage:
  python3 scripts/gmr_reference.py <bvh> <robot> <out.json> [--max-frames N]
  GMR_ROOT=/path/to/GMR python3 scripts/gmr_reference.py ...
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

GMR_ROOT = Path(os.environ.get("GMR_ROOT", "/tmp/gmr")).resolve()
sys.path.insert(0, str(GMR_ROOT))

import numpy as np  # noqa: E402
from general_motion_retargeting.motion_retarget import (  # noqa: E402
    GeneralMotionRetargeting as GMR,
)
from general_motion_retargeting.utils.lafan1 import load_bvh_file  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("bvh")
    ap.add_argument("robot")
    ap.add_argument("out")
    ap.add_argument("--max-frames", type=int, default=0, help="0 = all frames")
    args = ap.parse_args()

    frames, human_height = load_bvh_file(args.bvh, format="lafan1")
    if args.max_frames > 0:
        frames = frames[: args.max_frames]

    r = GMR(
        src_human="bvh_lafan1",
        tgt_robot=args.robot,
        actual_human_height=human_height,
        verbose=False,
    )

    r.update_targets(frames[0])
    targets0 = {
        k: {"pos": np.asarray(v[0]).tolist(), "quat": np.asarray(v[1]).tolist()}
        for k, v in r.scaled_human_data.items()
    }

    qpos_list = [np.asarray(r.retarget(f)).tolist() for f in frames]

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w") as fp:
        json.dump(
            {
                "robot": args.robot,
                "human_height": human_height,
                "targets0": targets0,
                "qpos": qpos_list,
            },
            fp,
        )
    print(f"wrote {out}: {len(qpos_list)} frames, nq={len(qpos_list[0])}")


if __name__ == "__main__":
    main()
