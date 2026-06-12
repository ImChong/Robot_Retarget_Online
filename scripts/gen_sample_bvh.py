#!/usr/bin/env python3
"""Generate license-free sample BVH motions with a LAFAN1-compatible skeleton.

The joint names match the LAFAN1 convention so GMR's bvh_lafan1 ik_configs work
out of the box (Hips, Spine2, Left/RightUpLeg, ..., Left/RightToe).
Outputs Y-up, centimeter BVH files into public/sample_motions/.

Usage: python3 scripts/gen_sample_bvh.py
"""

import math
import os

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "sample_motions")

# name, parent, offset (x, y, z) in cm, Y-up. Arms in T-pose along ±X.
SKELETON = [
    ("Hips", None, (0.0, 96.0, 0.0)),
    ("LeftUpLeg", "Hips", (9.0, -3.0, 0.0)),
    ("LeftLeg", "LeftUpLeg", (0.0, -42.0, 0.0)),
    ("LeftFoot", "LeftLeg", (0.0, -41.0, 0.0)),
    ("LeftToe", "LeftFoot", (0.0, -7.0, 12.5)),
    ("RightUpLeg", "Hips", (-9.0, -3.0, 0.0)),
    ("RightLeg", "RightUpLeg", (0.0, -42.0, 0.0)),
    ("RightFoot", "RightLeg", (0.0, -41.0, 0.0)),
    ("RightToe", "RightFoot", (0.0, -7.0, 12.5)),
    ("Spine", "Hips", (0.0, 10.0, 0.0)),
    ("Spine1", "Spine", (0.0, 11.0, 0.0)),
    ("Spine2", "Spine1", (0.0, 11.0, 0.0)),
    ("Neck", "Spine2", (0.0, 11.0, 0.0)),
    ("Head", "Neck", (0.0, 9.0, 0.0)),
    ("LeftShoulder", "Spine2", (5.0, 8.0, 0.0)),
    ("LeftArm", "LeftShoulder", (12.0, 0.0, 0.0)),
    ("LeftForeArm", "LeftArm", (27.0, 0.0, 0.0)),
    ("LeftHand", "LeftForeArm", (25.0, 0.0, 0.0)),
    ("RightShoulder", "Spine2", (-5.0, 8.0, 0.0)),
    ("RightArm", "RightShoulder", (-12.0, 0.0, 0.0)),
    ("RightForeArm", "RightArm", (-27.0, 0.0, 0.0)),
    ("RightHand", "RightForeArm", (-25.0, 0.0, 0.0)),
]

END_SITES = {
    "LeftToe": (0.0, 0.0, 4.0),
    "RightToe": (0.0, 0.0, 4.0),
    "Head": (0.0, 14.0, 0.0),
    "LeftHand": (8.0, 0.0, 0.0),
    "RightHand": (-8.0, 0.0, 0.0),
}

FPS = 30


def build_hierarchy():
    children = {name: [] for name, _, _ in SKELETON}
    root = None
    for name, parent, _ in SKELETON:
        if parent is None:
            root = name
        else:
            children[parent].append(name)
    return root, children


def write_hierarchy(f, name, children, offsets, depth):
    indent = "\t" * depth
    tag = "ROOT" if depth == 0 else "JOINT"
    f.write(f"{indent}{tag} {name}\n{indent}{{\n")
    ox, oy, oz = offsets[name] if depth > 0 else (0.0, 0.0, 0.0)
    f.write(f"{indent}\tOFFSET {ox:.4f} {oy:.4f} {oz:.4f}\n")
    f.write(
        f"{indent}\tCHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation\n"
    )
    for child in children[name]:
        write_hierarchy(f, child, children, offsets, depth + 1)
    if name in END_SITES:
        ex, ey, ez = END_SITES[name]
        f.write(f"{indent}\tEnd Site\n{indent}\t{{\n")
        f.write(f"{indent}\t\tOFFSET {ex:.4f} {ey:.4f} {ez:.4f}\n")
        f.write(f"{indent}\t}}\n")
    f.write(f"{indent}}}\n")


def euler_zyx(rz=0.0, ry=0.0, rx=0.0):
    """BVH channel order: Zrotation Yrotation Xrotation (degrees)."""
    return (rz, ry, rx)


def walk_pose(t, name):
    """Joint euler angles (deg) for a simple forward walk at time t (seconds)."""
    f = 1.1  # stride frequency Hz (full cycle)
    w = 2 * math.pi * f
    swing = math.sin(w * t)
    swing_r = math.sin(w * t + math.pi)
    lift_l = max(0.0, math.sin(w * t + math.pi / 2))
    lift_r = max(0.0, math.sin(w * t + math.pi / 2 + math.pi))

    if name == "Hips":
        return euler_zyx(rz=2.0 * math.sin(w * t), ry=3.0 * swing, rx=4.0)
    if name == "LeftUpLeg":
        return euler_zyx(rx=-25.0 * swing - 5.0)
    if name == "RightUpLeg":
        return euler_zyx(rx=-25.0 * swing_r - 5.0)
    if name == "LeftLeg":
        return euler_zyx(rx=18.0 + 30.0 * lift_l)
    if name == "RightLeg":
        return euler_zyx(rx=18.0 + 30.0 * lift_r)
    if name == "LeftFoot":
        # keep the foot roughly level: cancel hip + knee pitch
        return euler_zyx(rx=(25.0 * swing + 5.0) - (18.0 + 30.0 * lift_l))
    if name == "RightFoot":
        return euler_zyx(rx=(25.0 * swing_r + 5.0) - (18.0 + 30.0 * lift_r))
    if name in ("LeftToe", "RightToe"):
        return euler_zyx()
    if name == "Spine":
        return euler_zyx(ry=-2.0 * swing, rx=-2.0)
    if name == "Spine1":
        return euler_zyx(ry=-2.0 * swing)
    if name == "Spine2":
        return euler_zyx(ry=-2.0 * swing, rx=-2.0)
    if name == "Neck":
        return euler_zyx(ry=2.0 * swing)
    if name == "Head":
        return euler_zyx()
    if name == "LeftShoulder":
        return euler_zyx()
    if name == "LeftArm":
        # bring arm down from T-pose, then swing opposite to the left leg
        return euler_zyx(rz=-72.0, rx=18.0 * swing_r)
    if name == "LeftForeArm":
        return euler_zyx(rz=-12.0, rx=10.0 * swing_r - 12.0)
    if name == "RightArm":
        return euler_zyx(rz=72.0, rx=18.0 * swing)
    if name == "RightForeArm":
        return euler_zyx(rz=12.0, rx=10.0 * swing - 12.0)
    if name == "RightHand" or name == "LeftHand":
        return euler_zyx()
    return euler_zyx()


def wave_pose(t, name):
    """Standing pose, right arm waving."""
    sway = math.sin(2 * math.pi * 0.4 * t)
    wavef = math.sin(2 * math.pi * 1.6 * t)
    if name == "Hips":
        return euler_zyx(rz=1.5 * sway)
    if name in ("LeftUpLeg", "RightUpLeg"):
        return euler_zyx(rx=-4.0)
    if name in ("LeftLeg", "RightLeg"):
        return euler_zyx(rx=8.0)
    if name in ("LeftFoot", "RightFoot"):
        return euler_zyx(rx=-4.0)
    if name == "LeftArm":
        return euler_zyx(rz=-72.0)
    if name == "LeftForeArm":
        return euler_zyx(rz=-10.0, rx=-10.0)
    if name == "RightArm":
        # raised up, waving
        return euler_zyx(rz=35.0, rx=8.0 * wavef)
    if name == "RightForeArm":
        return euler_zyx(rz=55.0 + 18.0 * wavef)
    if name == "Spine2":
        return euler_zyx(rz=-2.0 * sway)
    if name == "Head":
        return euler_zyx(rz=2.0 * sway)
    return euler_zyx()


def root_pos_walk(t):
    f = 1.1
    w = 2 * math.pi * f
    speed_cm = 85.0  # forward speed cm/s along +Z
    bob = 2.2 * math.sin(2 * w * t)
    sway = 1.6 * math.sin(w * t)
    return (sway, 96.0 + bob - 1.5, speed_cm * t)


def root_pos_wave(t):
    sway = math.sin(2 * math.pi * 0.4 * t)
    return (1.0 * sway, 95.0, 0.0)


def generate(path, seconds, pose_fn, root_fn):
    root, children = build_hierarchy()
    offsets = {name: off for name, _, off in SKELETON}
    order = [name for name, _, _ in SKELETON]  # matches hierarchy traversal order

    # hierarchy traversal order must match channel order in MOTION lines
    traversal = []

    def visit(name):
        traversal.append(name)
        for child in children[name]:
            visit(child)

    visit(root)
    assert traversal == order, "SKELETON list must be in depth-first order"

    frames = int(seconds * FPS)
    with open(path, "w") as f:
        f.write("HIERARCHY\n")
        write_hierarchy(f, root, children, offsets, 0)
        f.write("MOTION\n")
        f.write(f"Frames: {frames}\n")
        f.write(f"Frame Time: {1.0 / FPS:.7f}\n")
        for i in range(frames):
            t = i / FPS
            values = []
            for name in traversal:
                if name == root:
                    px, py, pz = root_fn(t)
                else:
                    px, py, pz = offsets[name]
                rz, ry, rx = pose_fn(t, name)
                values += [f"{px:.4f}", f"{py:.4f}", f"{pz:.4f}",
                           f"{rz:.4f}", f"{ry:.4f}", f"{rx:.4f}"]
            f.write(" ".join(values) + "\n")
    print(f"wrote {path} ({frames} frames)")


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    generate(os.path.join(OUT_DIR, "walk.bvh"), 8.0, walk_pose, root_pos_walk)
    generate(os.path.join(OUT_DIR, "wave.bvh"), 6.0, wave_pose, root_pos_wave)
