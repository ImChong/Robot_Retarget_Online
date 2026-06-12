#!/usr/bin/env python3
"""Generate license-free sample BVH motions with a LAFAN1-compatible skeleton.

The skeleton (22 joints, names, offsets and neutral orientations) matches the
raw LAFAN1 rig conventions so GMR's bvh_lafan1 ik_configs work out of the box:
Y-up centimeters, CHANNELS 6 with Z Y X rotation order, T-pose stance facing
+Z (+X = character's left), and "X-along-bone" local frames (every joint's +X
axis points along its bone, mirroring lives in the rotation data).

Neutral T-pose constants (quaternions/positions below) follow the standard
LAFAN1 calibration stance; all motion curves are procedural and original.

Usage: python3 scripts/gen_sample_bvh.py
"""

import math
import os

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "sample_motions")
FPS = 30

# ---------------------------------------------------------------- quaternions
# wxyz, Hamilton; no external deps.


def qmul(a, b):
    aw, ax, ay, az = a
    bw, bx, by, bz = b
    return (
        aw * bw - ax * bx - ay * by - az * bz,
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
    )


def qconj(q):
    return (q[0], -q[1], -q[2], -q[3])


def qrot(q, v):
    w, x, y, z = q
    tx = 2 * (y * v[2] - z * v[1])
    ty = 2 * (z * v[0] - x * v[2])
    tz = 2 * (x * v[1] - y * v[0])
    return (
        v[0] + w * tx + (y * tz - z * ty),
        v[1] + w * ty + (z * tx - x * tz),
        v[2] + w * tz + (x * ty - y * tx),
    )


def qaxis(axis, deg):
    h = math.radians(deg) / 2
    s = math.sin(h)
    return (math.cos(h), axis[0] * s, axis[1] * s, axis[2] * s)


def q_to_euler_zyx_deg(q):
    """Intrinsic Z-Y-X euler (BVH 'Zrotation Yrotation Xrotation'), degrees."""
    w, x, y, z = q
    m00 = 1 - 2 * (y * y + z * z)
    m10 = 2 * (x * y + w * z)
    m20 = 2 * (x * z - w * y)
    m21 = 2 * (y * z + w * x)
    m22 = 1 - 2 * (x * x + y * y)
    sy = max(-1.0, min(1.0, -m20))
    theta = math.asin(sy)
    if abs(sy) < 0.9999999:
        psi = math.atan2(m10, m00)
        phi = math.atan2(m21, m22)
    else:
        psi = math.atan2(-2 * (x * y - w * z), 1 - 2 * (x * x + z * z))
        phi = 0.0
    return (math.degrees(psi), math.degrees(theta), math.degrees(phi))


# -------------------------------------------------------------- neutral pose
# (world quaternion wxyz, world position cm) per joint: LAFAN1 T-pose
# calibration stance, Y-up, facing +Z, +X = character's left, X-along-bone
# local frames. Root recentered to x=z=0.

STANCE = {
    "Hips": ((0.494713, 0.508499, 0.510702, 0.485665), (0.0, 91.9524, 0.0)),
    "LeftUpLeg": ((-0.575283, -0.447884, 0.465659, 0.501609), (10.6132, 92.002, 1.4461)),
    "LeftLeg": ((-0.492463, -0.522986, 0.406136, 0.564818), (13.358, 48.7519, 5.2066)),
    "LeftFoot": ((-0.725949, -0.143444, 0.653797, 0.158021), (14.7168, 7.1801, -2.8767)),
    "LeftToe": ((-0.742694, -0.019243, 0.669051, 0.020135), (16.363, -0.034, 12.7609)),
    "RightUpLeg": ((0.496942, 0.480192, -0.52826, -0.493361), (-10.4674, 92.151, 2.2642)),
    "RightLeg": ((0.415673, 0.586641, -0.475372, -0.50704), (-12.4218, 48.752, 4.492)),
    "RightFoot": ((0.613213, 0.168767, -0.762467, -0.118873), (-10.987, 7.2581, -3.9698)),
    "RightToe": ((0.624602, 0.023896, -0.780573, -0.002656), (-14.2909, 0.2836, 11.5134)),
    "Spine": ((0.468078, 0.532871, 0.488575, 0.508179), (-0.0554, 98.8248, -2.6801)),
    "Spine1": ((0.458148, 0.537943, 0.489645, 0.510848), (0.0213, 111.368, -1.6201)),
    "Spine2": ((0.44958, 0.541576, 0.492156, 0.512206), (0.0036, 123.6481, -0.3741)),
    "Neck": ((0.4285, 0.507435, 0.499739, 0.556021), (-0.2326, 149.3166, 2.5262)),
    "Head": ((0.404994, 0.637092, 0.381299, 0.533578), (-1.6187, 160.8912, 4.1266)),
    "LeftShoulder": ((0.729784, -0.678292, 0.033437, 0.078852), (5.6997, 143.5364, -0.0507)),
    "LeftArm": ((0.639561, -0.768546, -0.011985, -0.012464), (16.8183, 144.3232, -1.8084)),
    "LeftForeArm": ((0.633086, -0.76396, -0.124138, 0.012513), (49.7986, 144.405, -0.6703)),
    "LeftHand": ((0.743604, -0.663994, -0.017298, 0.076585), (74.2141, 149.584, 2.8088)),
    "RightShoulder": ((0.026999, 0.041513, 0.729282, -0.682419), (-6.2683, 143.3301, 0.8019)),
    "RightArm": ((0.060028, -0.022036, 0.625996, -0.7772), (-17.4972, 143.5976, -0.2818)),
    "RightForeArm": ((-0.125938, 0.000887, 0.613494, -0.779592), (-50.2274, 139.6079, -1.6316)),
    "RightHand": ((-0.087399, 0.143482, 0.653131, -0.738373), (-74.6278, 144.5832, 2.2275)),
}

# purely cosmetic end sites (local frame, +X along bone), for nicer rendering
END_LOCAL = {
    "Head": (12.0, 0.0, 0.0),
    "LeftToe": (6.0, 0.0, 0.0),
    "RightToe": (6.0, 0.0, 0.0),
    "LeftHand": (9.0, 0.0, 0.0),
    "RightHand": (9.0, 0.0, 0.0),
}

SKEL = [
    ("Hips", None),
    ("LeftUpLeg", "Hips"),
    ("LeftLeg", "LeftUpLeg"),
    ("LeftFoot", "LeftLeg"),
    ("LeftToe", "LeftFoot"),
    ("RightUpLeg", "Hips"),
    ("RightLeg", "RightUpLeg"),
    ("RightFoot", "RightLeg"),
    ("RightToe", "RightFoot"),
    ("Spine", "Hips"),
    ("Spine1", "Spine"),
    ("Spine2", "Spine1"),
    ("Neck", "Spine2"),
    ("Head", "Neck"),
    ("LeftShoulder", "Spine2"),
    ("LeftArm", "LeftShoulder"),
    ("LeftForeArm", "LeftArm"),
    ("LeftHand", "LeftForeArm"),
    ("RightShoulder", "Spine2"),
    ("RightArm", "RightShoulder"),
    ("RightForeArm", "RightArm"),
    ("RightHand", "RightForeArm"),
]

NAMES = [n for n, _ in SKEL]
PARENT = {n: p for n, p in SKEL}
BASE_Q = {n: STANCE[n][0] for n in NAMES}
BASE_P = {n: STANCE[n][1] for n in NAMES}

OFFSET = {NAMES[0]: (0.0, 0.0, 0.0)}
for n in NAMES[1:]:
    p = PARENT[n]
    d = tuple(a - b for a, b in zip(BASE_P[n], BASE_P[p]))
    OFFSET[n] = qrot(qconj(BASE_Q[p]), d)
END_OFFSET = dict(END_LOCAL)

X = (1, 0, 0)  # character left / sagittal swing axis
Y = (0, 1, 0)  # up / yaw axis
Z = (0, 0, 1)  # forward / roll axis

# arms-down pose: rotate T-pose arms in the frontal plane about forward axis Z
HANG_L = qaxis(Z, -75)
HANG_R = qaxis(Z, 75)


def arm_chain(pre_upper, pre_fore, side):
    """World pre-rotations for an arm chain hanging from T-pose."""
    hang = HANG_L if side == "L" else HANG_R
    upper = qmul(pre_upper, hang)
    fore = qmul(pre_fore, upper)
    return upper, fore


# ------------------------------------------------------------------ motions
def walk_globals(t):
    f = 1.1
    w = 2 * math.pi * f
    s = math.sin(w * t)
    s_r = math.sin(w * t + math.pi)
    lift_l = max(0.0, math.sin(w * t + math.pi / 2))
    lift_r = max(0.0, math.sin(w * t + math.pi / 2 + math.pi))

    thigh_l = -28 * s - 6  # about X, negative = forward swing
    thigh_r = -28 * s_r - 6
    knee_l = 16 + 34 * lift_l  # positive = shank backward
    knee_r = 16 + 34 * lift_r

    pre = {}
    pre["Hips"] = qmul(qaxis(Y, 5 * s), qmul(qaxis(Z, 2.0 * s), qaxis(X, 6)))
    pre["Spine"] = qaxis(X, -2)
    pre["Spine1"] = qaxis(Y, -4 * s)
    pre["Spine2"] = qmul(qaxis(Y, -6 * s), qaxis(X, -3))
    pre["Neck"] = qaxis(Y, 4 * s)
    pre["Head"] = qaxis(Y, 4 * s)

    pre["LeftUpLeg"] = qaxis(X, thigh_l)
    pre["LeftLeg"] = qaxis(X, thigh_l + knee_l)
    pre["LeftFoot"] = qaxis(X, -10 * max(0.0, -s))  # heel strike pitch
    pre["LeftToe"] = pre["LeftFoot"]
    pre["RightUpLeg"] = qaxis(X, thigh_r)
    pre["RightLeg"] = qaxis(X, thigh_r + knee_r)
    pre["RightFoot"] = qaxis(X, -10 * max(0.0, -s_r))
    pre["RightToe"] = pre["RightFoot"]

    swing_l = qaxis(X, -14 * s_r)  # arms counter-swing about X
    swing_r = qaxis(X, -14 * s)
    elbow_l = qaxis(X, -22 + 8 * s_r)
    elbow_r = qaxis(X, -22 + 8 * s)
    upper_l, fore_l = arm_chain(swing_l, elbow_l, "L")
    upper_r, fore_r = arm_chain(swing_r, elbow_r, "R")
    pre["LeftShoulder"] = (1, 0, 0, 0)
    pre["LeftArm"] = upper_l
    pre["LeftForeArm"] = fore_l
    pre["LeftHand"] = fore_l
    pre["RightShoulder"] = (1, 0, 0, 0)
    pre["RightArm"] = upper_r
    pre["RightForeArm"] = fore_r
    pre["RightHand"] = fore_r

    speed = 90.0  # cm/s along +Z
    root = (1.8 * s, 89.5 + 2.0 * math.sin(2 * w * t), speed * t)
    return pre, root


def wave_globals(t):
    sway = math.sin(2 * math.pi * 0.4 * t)
    wig = math.sin(2 * math.pi * 1.6 * t)
    pre = {name: (1, 0, 0, 0) for name in NAMES}
    pre["Hips"] = qaxis(Z, 2 * sway)
    pre["Spine2"] = qaxis(Z, -1.5 * sway)
    pre["Neck"] = qaxis(Z, -1.5 * sway)
    pre["Head"] = qmul(qaxis(Z, -2 * sway), qaxis(Y, 4 * sway))

    # left arm relaxed at the side
    upper_l, fore_l = arm_chain(qaxis(X, 2 * sway), qaxis(X, -15), "L")
    pre["LeftArm"] = upper_l
    pre["LeftForeArm"] = fore_l
    pre["LeftHand"] = fore_l

    # right arm: raised up-right in the frontal plane, forearm waving
    raise_q = qaxis(Z, 35 + 3 * wig)  # from T-pose horizontal up to ~125deg abduction
    fore_q = qmul(qmul(qaxis(Z, 30 + 18 * wig), qaxis(X, -10)), raise_q)
    pre["RightArm"] = raise_q
    pre["RightForeArm"] = fore_q
    pre["RightHand"] = fore_q

    # subtle weight shift
    legs = qaxis(Z, 1.2 * sway)
    for n in ("LeftUpLeg", "LeftLeg", "RightUpLeg", "RightLeg"):
        pre[n] = legs
    root = (1.0 * sway, 91.3 + 0.3 * sway, 0.0)
    return pre, root


# ------------------------------------------------------------------ writer
def hierarchy_lines():
    children = {n: [] for n in NAMES}
    for n, p in SKEL:
        if p:
            children[p].append(n)
    lines = ["HIERARCHY"]

    def emit(name, depth):
        ind = "\t" * depth
        tag = "ROOT" if depth == 0 else "JOINT"
        off = (0.0, 0.0, 0.0) if depth == 0 else OFFSET[name]
        lines.append(f"{ind}{tag} {name}")
        lines.append(ind + "{")
        lines.append(f"{ind}\tOFFSET {off[0]:.6f} {off[1]:.6f} {off[2]:.6f}")
        lines.append(
            f"{ind}\tCHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation"
        )
        for c in children[name]:
            emit(c, depth + 1)
        if name in END_OFFSET:
            e = END_OFFSET[name]
            lines.append(f"{ind}\tEnd Site")
            lines.append(ind + "\t{")
            lines.append(f"{ind}\t\tOFFSET {e[0]:.6f} {e[1]:.6f} {e[2]:.6f}")
            lines.append(ind + "\t}")
        lines.append(ind + "}")

    emit(NAMES[0], 0)
    return lines


def generate(path, seconds, globals_fn):
    frames = int(seconds * FPS)
    lines = hierarchy_lines()
    lines.append("MOTION")
    lines.append(f"Frames: {frames}")
    lines.append(f"Frame Time: {1.0 / FPS:.7f}")

    min_foot_y = float("inf")
    for i in range(frames):
        t = i / FPS
        pre, root = globals_fn(t)
        q_global = {n: qmul(pre[n], BASE_Q[n]) for n in NAMES}
        pos_global = {NAMES[0]: root}
        for n in NAMES[1:]:
            p = PARENT[n]
            pos_global[n] = tuple(
                a + b for a, b in zip(pos_global[p], qrot(q_global[p], OFFSET[n]))
            )
        for fn in ("LeftToe", "RightToe"):
            end = tuple(
                a + b for a, b in zip(pos_global[fn], qrot(q_global[fn], END_OFFSET[fn]))
            )
            min_foot_y = min(min_foot_y, pos_global[fn][1], end[1])

        vals = []
        for n in NAMES:
            p = PARENT[n]
            if p is None:
                lp = root
                lq = q_global[n]
            else:
                lp = OFFSET[n]
                lq = qmul(qconj(q_global[p]), q_global[n])
            zr, yr, xr = q_to_euler_zyx_deg(lq)
            vals += [
                f"{lp[0]:.4f}", f"{lp[1]:.4f}", f"{lp[2]:.4f}",
                f"{zr:.4f}", f"{yr:.4f}", f"{xr:.4f}",
            ]
        lines.append(" ".join(vals))

    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"wrote {path} ({frames} frames, min foot height {min_foot_y:.1f} cm)")


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    generate(os.path.join(OUT_DIR, "walk.bvh"), 8.0, walk_globals)
    generate(os.path.join(OUT_DIR, "wave.bvh"), 6.0, wave_globals)
