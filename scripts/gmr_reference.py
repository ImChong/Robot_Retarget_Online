#!/usr/bin/env python3
"""Run the ORIGINAL GMR pipeline on a BVH file and dump reference outputs
(frame-0 preprocessed targets + per-frame qpos) for parity testing against
the web engine. Requires /tmp/GMR checkout and /tmp/gmr_lite shim.

Usage: python3 scripts/gmr_reference.py <bvh> <robot> <out.json>
"""

import json
import sys

sys.path.insert(0, "/tmp/gmr_lite")

import numpy as np  # noqa: E402
from general_motion_retargeting.motion_retarget import (  # noqa: E402
    GeneralMotionRetargeting as GMR,
)
from general_motion_retargeting.utils.lafan1 import load_bvh_file  # noqa: E402


def main():
    bvh, robot, out = sys.argv[1], sys.argv[2], sys.argv[3]
    frames, human_height = load_bvh_file(bvh, format="lafan1")
    r = GMR(src_human="bvh_lafan1", tgt_robot=robot, actual_human_height=human_height,
            verbose=False)

    # Frame-0 preprocessed targets (after scale + offsets), before any IK.
    r.update_targets(frames[0])
    targets0 = {
        k: {"pos": np.asarray(v[0]).tolist(), "quat": np.asarray(v[1]).tolist()}
        for k, v in r.scaled_human_data.items()
    }

    qpos_list = []
    for f in frames:
        qpos_list.append(np.asarray(r.retarget(f)).tolist())

    with open(out, "w") as fp:
        json.dump(
            {
                "robot": robot,
                "human_height": human_height,
                "targets0": targets0,
                "qpos": qpos_list,
            },
            fp,
        )
    print(f"wrote {out}: {len(qpos_list)} frames, nq={len(qpos_list[0])}")


if __name__ == "__main__":
    main()
