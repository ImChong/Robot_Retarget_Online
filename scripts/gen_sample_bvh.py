#!/usr/bin/env python3
"""Legacy: procedurally generated sample BVH motions (replaced by LAFAN1 clips).

Bundled web samples are now prepared via scripts/prepare_lafan_samples.py from the
Ubisoft LAFAN1 dataset. This generator is kept for reference / local experiments.

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


IDENT = (1.0, 0.0, 0.0, 0.0)


def smoothstep(a, b, x):
    if b <= a:
        return 0.0 if x < a else 1.0
    u = max(0.0, min(1.0, (x - a) / (b - a)))
    return u * u * (3 - 2 * u)


def piecewise(t, keys):
    """Smoothstep interpolation through (time, value) keyframes."""
    if t <= keys[0][0]:
        return keys[0][1]
    if t >= keys[-1][0]:
        return keys[-1][1]
    for i in range(len(keys) - 1):
        t0, v0 = keys[i]
        t1, v1 = keys[i + 1]
        if t0 <= t <= t1:
            return v0 + (v1 - v0) * smoothstep(t0, t1, t)
    return keys[-1][1]


def set_legs(pre, hipL, kneeL, footL, hipR, kneeR, footR):
    """Leg articulation. hip>0 = thigh swings forward, knee>0 = shank folds back."""
    pre["LeftUpLeg"] = qaxis(X, -hipL)
    pre["LeftLeg"] = qaxis(X, -hipL + kneeL)
    pre["LeftFoot"] = qaxis(X, footL)
    pre["LeftToe"] = pre["LeftFoot"]
    pre["RightUpLeg"] = qaxis(X, -hipR)
    pre["RightLeg"] = qaxis(X, -hipR + kneeR)
    pre["RightFoot"] = qaxis(X, footR)
    pre["RightToe"] = pre["RightFoot"]


def set_arms(pre, swingL, elbowL, swingR, elbowR):
    """Arm articulation about X (swing>0 raises the arm forward; elbow<0 bends)."""
    uL, fL = arm_chain(qaxis(X, swingL), qaxis(X, elbowL), "L")
    uR, fR = arm_chain(qaxis(X, swingR), qaxis(X, elbowR), "R")
    pre["LeftArm"], pre["LeftForeArm"], pre["LeftHand"] = uL, fL, fL
    pre["RightArm"], pre["RightForeArm"], pre["RightHand"] = uR, fR, fR


# ----------------------------------------------------------- grounding helpers
GROUND_TARGET = 1.0  # cm clearance for the lowest contact point when grounded
FEET = ("LeftToe", "RightToe", "LeftFoot", "RightFoot")
BODY_POINTS = FEET + ("Hips", "Spine", "Spine2", "Head", "LeftHand", "RightHand")


def _fk_positions(q_global, root):
    pos = {NAMES[0]: root}
    for n in NAMES[1:]:
        p = PARENT[n]
        pos[n] = tuple(a + b for a, b in zip(pos[p], qrot(q_global[p], OFFSET[n])))
    return pos


def _lowest_point(pos, q_global, joints):
    lowest = float("inf")
    for fn in joints:
        lowest = min(lowest, pos[fn][1])
        if fn in END_OFFSET:
            end_y = pos[fn][1] + qrot(q_global[fn], END_OFFSET[fn])[1]
            lowest = min(lowest, end_y)
    return lowest


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
    return pre, root, IDENT


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
    return pre, root, IDENT


def run_globals(t):
    f = 2.4
    w = 2 * math.pi * f
    s = math.sin(w * t)
    s_r = math.sin(w * t + math.pi)
    lift_l = max(0.0, math.sin(w * t + math.pi / 2))
    lift_r = max(0.0, math.sin(w * t + math.pi / 2 + math.pi))

    pre = {n: IDENT for n in NAMES}
    # whole-body forward lean
    body = qaxis(X, 13)

    pre["Hips"] = qmul(qaxis(Y, 7 * s), qaxis(Z, 3 * s))
    pre["Spine"] = qaxis(X, -4)
    pre["Spine1"] = qaxis(Y, -6 * s)
    pre["Spine2"] = qmul(qaxis(Y, -8 * s), qaxis(X, -4))
    pre["Neck"] = qaxis(X, 8)  # keep head level against the lean
    pre["Head"] = qaxis(X, 8)

    thigh_l = 46 * s - 6  # +s here = forward because hip uses -angle in set_legs
    thigh_r = 46 * s_r - 6
    set_legs(
        pre,
        hipL=thigh_l,
        kneeL=22 + 70 * lift_l,
        footL=8 - 18 * lift_l,
        hipR=thigh_r,
        kneeR=22 + 70 * lift_r,
        footR=8 - 18 * lift_r,
    )
    # bent-elbow arm drive, opposite to legs
    set_arms(pre, swingL=48 * s_r, elbowL=-95 + 18 * s_r, swingR=48 * s, elbowR=-95 + 18 * s)

    speed = 295.0  # cm/s
    root = (1.6 * s, 92.5 + 4.5 * abs(math.sin(w * t)), speed * t)
    return pre, root, body


def fall_getup_globals(t):
    # scalar keyframes (seconds): pitch about X (deg, neg = fall backward),
    # pelvis height (cm), pelvis z (cm, neg = slid back), hip/knee flex (deg),
    # arm swing/elbow (deg). Recognizable: sit back -> supine -> tuck/rock ->
    # squat -> stand.
    pitch = piecewise(t, [(0, 0), (1.0, -12), (2.0, -58), (2.8, -90),
                          (3.6, -78), (4.6, 16), (5.6, 6), (6.5, 0)])
    hip = piecewise(t, [(0, 4), (1.0, 35), (2.0, 75), (2.8, 40),
                        (3.6, 100), (4.6, 118), (5.6, 38), (6.5, 4)])
    knee = piecewise(t, [(0, 8), (1.0, 45), (2.0, 80), (2.8, 35),
                         (3.6, 110), (4.6, 122), (5.6, 48), (6.5, 8)])
    arm_sw = piecewise(t, [(0, 4), (1.0, -25), (2.0, -55), (2.8, -70),
                           (3.6, 20), (4.6, 70), (5.6, 30), (6.5, 4)])
    arm_el = piecewise(t, [(0, -8), (1.0, -20), (2.0, -30), (2.8, -20),
                           (3.6, -55), (4.6, -70), (5.6, -30), (6.5, -8)])

    pre = {n: IDENT for n in NAMES}
    body = qaxis(X, pitch)
    pre["Spine"] = qaxis(X, max(-25, pitch * 0.12))
    pre["Spine2"] = qaxis(X, max(-25, pitch * 0.12))
    pre["Neck"] = qaxis(X, -pitch * 0.25)  # try to keep head tucked toward chest
    pre["Head"] = qaxis(X, -pitch * 0.25)
    set_legs(pre, hip, knee, 0, hip, knee, 0)
    set_arms(pre, arm_sw, arm_el, arm_sw, arm_el)
    return pre, (0.0, 0.0, 0.0), body  # height set by auto-ground


def _flip_pose(t, spin_axis, spin_sign):
    """Crouch -> launch -> 360 deg tucked air rotation -> land. Pose only."""
    hip = piecewise(t, [(0, 6), (0.34, 52), (0.50, 8), (0.85, 118),
                        (1.10, 16), (1.30, 48), (1.7, 6)])
    knee = piecewise(t, [(0, 10), (0.34, 78), (0.50, 10), (0.85, 128),
                         (1.10, 18), (1.30, 70), (1.7, 10)])
    arm_sw = piecewise(t, [(0, -35), (0.34, -55), (0.50, 60), (0.85, 120),
                           (1.10, 80), (1.30, 20), (1.7, 4)])
    arm_el = piecewise(t, [(0, -10), (0.34, -20), (0.85, -120), (1.30, -40), (1.7, -10)])

    pre = {n: IDENT for n in NAMES}
    set_legs(pre, hip, knee, 0, hip, knee, 0)
    set_arms(pre, arm_sw, arm_el, arm_sw, arm_el)

    spin = spin_sign * 360.0 * smoothstep(0.50, 1.16, t)
    lean = qaxis(X, -12 * smoothstep(0.0, 0.34, t) * (1 - smoothstep(0.5, 0.7, t)))
    body = qmul(qaxis(spin_axis, spin), lean)
    return pre, body


def _grounded_y(t, spin_axis, spin_sign, joints=FEET):
    """Pelvis height that rests the lowest foot of the t-pose on the ground."""
    pre, body = _flip_pose(t, spin_axis, spin_sign)
    q_global = {n: qmul(body, qmul(pre[n], BASE_Q[n])) for n in NAMES}
    pos = _fk_positions(q_global, (0.0, 0.0, 0.0))
    return GROUND_TARGET - _lowest_point(pos, q_global, joints)


def _flip_height(t, stand_y, crouch_y, land_y):
    apex_y = stand_y + 72.0
    return piecewise(t, [
        (0.0, stand_y), (0.34, crouch_y), (0.50, crouch_y + 8),
        (0.85, apex_y), (1.12, land_y + 26), (1.30, land_y), (1.7, stand_y),
    ])


# Precompute grounded stance heights for each flip's crouch / stand / land poses.
_BF = dict(stand_y=_grounded_y(0.0, X, -1), crouch_y=_grounded_y(0.34, X, -1),
           land_y=_grounded_y(1.30, X, -1))
_SF = dict(stand_y=_grounded_y(0.0, Z, 1), crouch_y=_grounded_y(0.34, Z, 1),
           land_y=_grounded_y(1.30, Z, 1))


def backflip_globals(t):
    # backward spin about the left-right axis X; travels slightly backward (-Z)
    pre, body = _flip_pose(t, X, -1)
    ry = _flip_height(t, **_BF)
    drift = -18.0 * smoothstep(0.5, 1.25, t)
    return pre, (0.0, ry, drift), body


def sideflip_globals(t):
    # sideways aerial about the forward axis Z; drifts toward +X
    pre, body = _flip_pose(t, Z, 1)
    ry = _flip_height(t, **_SF)
    drift = 18.0 * smoothstep(0.5, 1.25, t)
    return pre, (drift, ry, 0.0), body


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


def generate(path, seconds, globals_fn, ground_fn=None, ground_joints=FEET):
    frames = int(seconds * FPS)
    lines = hierarchy_lines()
    lines.append("MOTION")
    lines.append(f"Frames: {frames}")
    lines.append(f"Frame Time: {1.0 / FPS:.7f}")

    min_foot_y = float("inf")
    max_root_y = -float("inf")
    for i in range(frames):
        t = i / FPS
        pre, root, body = globals_fn(t)
        q_global = {n: qmul(body, qmul(pre[n], BASE_Q[n])) for n in NAMES}

        # Auto-ground stance frames: shift the whole body so the lowest foot
        # rests at GROUND_TARGET (positions translate rigidly with the root).
        if ground_fn is not None and ground_fn(t):
            pos = _fk_positions(q_global, root)
            delta = GROUND_TARGET - _lowest_point(pos, q_global, ground_joints)
            root = (root[0], root[1] + delta, root[2])

        pos_global = _fk_positions(q_global, root)
        min_foot_y = min(min_foot_y, _lowest_point(pos_global, q_global, FEET))
        max_root_y = max(max_root_y, root[1])

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
    print(
        f"wrote {path} ({frames} frames, min foot {min_foot_y:.1f} cm, "
        f"peak pelvis {max_root_y:.1f} cm)"
    )


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    generate(os.path.join(OUT_DIR, "walk.bvh"), 8.0, walk_globals)
    generate(os.path.join(OUT_DIR, "wave.bvh"), 6.0, wave_globals)
    generate(os.path.join(OUT_DIR, "run.bvh"), 6.0, run_globals)
    generate(os.path.join(OUT_DIR, "fall_getup.bvh"), 6.5, fall_getup_globals,
             ground_fn=lambda _t: True, ground_joints=BODY_POINTS)
    # flips author pelvis height directly (grounded crouch/land + air parabola)
    generate(os.path.join(OUT_DIR, "backflip.bvh"), 1.7, backflip_globals)
    generate(os.path.join(OUT_DIR, "sideflip.bvh"), 1.7, sideflip_globals)
