#!/usr/bin/env python3
"""Diagnostic: run the original GMR pipeline on each sample BVH and report
whether the retargeted robot motion is sane (finite qpos, joint ranges,
pelvis orientation winding for flips, final standing pose).

Usage: python3 scripts/validate_samples.py [robot]
"""

import sys

sys.path.insert(0, "/tmp/gmr_lite")

import numpy as np  # noqa: E402
import mujoco as mj  # noqa: E402
from scipy.spatial.transform import Rotation as R  # noqa: E402
from general_motion_retargeting.motion_retarget import (  # noqa: E402
    GeneralMotionRetargeting as GMR,
)
from general_motion_retargeting.utils.lafan1 import load_bvh_file  # noqa: E402

ROBOT = sys.argv[1] if len(sys.argv) > 1 else "unitree_g1"
XML = {
    "unitree_g1": "/tmp/GMR/assets/unitree_g1/g1_mocap_29dof.xml",
    "booster_t1_29dof": "/tmp/GMR/assets/booster_t1_29dof/t1_mocap.xml",
}[ROBOT]

MOTIONS = ["walk", "run", "fall_getup", "backflip", "sideflip", "wave"]


def main():
    model = mj.MjModel.from_xml_path(XML)
    data = mj.MjData(model)
    pelvis = mj.mj_name2id(model, mj.mjtObj.mjOBJ_BODY, "pelvis" if ROBOT == "unitree_g1" else "Waist")

    # hinge joint ranges for limit checks
    lo = model.jnt_range[:, 0].copy()
    hi = model.jnt_range[:, 1].copy()
    qadr = model.jnt_qposadr
    limited = model.jnt_limited.astype(bool)
    jtype = model.jnt_type

    print(f"== robot: {ROBOT} ==")
    for name in MOTIONS:
        path = f"public/sample_motions/{name}.bvh"
        frames, h = load_bvh_file(path, format="lafan1")
        r = GMR(src_human="bvh_lafan1", tgt_robot=ROBOT, actual_human_height=h, verbose=False)
        qpos = np.array([r.retarget(f) for f in frames])

        finite = np.isfinite(qpos).all()
        # pelvis pitch winding: total rotation about its own + world to detect flip
        pitches = []
        heights = qpos[:, 2]
        ups = []
        for f in range(len(frames)):
            data.qpos[:] = qpos[f]
            mj.mj_kinematics(model, data)
            Rm = data.xmat[pelvis].reshape(3, 3)
            ups.append(Rm[2, 2])  # world-z component of body-z (1=upright,-1=inverted)
        ups = np.array(ups)
        # joint-limit violations
        viol = 0
        nlim = 0
        for j in range(model.njnt):
            if not limited[j] or jtype[j] == mj.mjtJoint.mjJNT_FREE:
                continue
            nlim += 1
            col = qpos[:, qadr[j]]
            if (col < lo[j] - 1e-4).any() or (col > hi[j] + 1e-4).any():
                viol += 1

        inverted = (ups < -0.3).any()
        n_inv = int((ups < 0).sum())
        print(
            f"{name:11s} frames={len(frames):3d} finite={finite} "
            f"pelvis_h[{heights.min():.2f},{heights.max():.2f}] "
            f"upright[start={ups[0]:+.2f} min={ups.min():+.2f} end={ups[-1]:+.2f}] "
            f"inverted_frames={n_inv} limitviol={viol}/{nlim}"
        )
        if name in ("backflip", "sideflip"):
            print(f"            -> {'FLIP OK (passes inversion)' if inverted else 'NO INVERSION DETECTED'}; "
                  f"lands upright={ups[-1] > 0.8}")
        if name == "fall_getup":
            print(f"            -> reaches_low_upright={ups.min() < 0.2}; ends_standing={ups[-1] > 0.8}")


if __name__ == "__main__":
    main()
