#!/usr/bin/env python3
"""Add massless foot-tip bodies to a MuJoCo Menagerie quadruped MJCF.

The GMR retargeting engine tracks IK keypoints on robot *bodies* (via
`mj_jacBody`). Menagerie quadruped models (Unitree Go2 / A1) put the foot at a
geom on the *calf* body, so there is no body at the foot tip to target. This
script emits a ``*_mocap.xml`` variant that appends a tiny massless body at the
foot tip of each ``<LEG>_calf`` body (LEG in FL/FR/RL/RR), named ``<LEG>_foot``
— giving the retargeter clean per-foot keypoints without changing the robot's
dynamics (the body has no joint, so it adds no DoF).

Usage:
    python3 scripts/add_quadruped_foot_sites.py <in.xml> <out.xml> <z_off>

``z_off`` is the foot-tip offset along the calf's local -Z (Go2: 0.213, A1: 0.2).
"""

import re
import sys


def main() -> None:
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(1)
    src, dst, z = sys.argv[1], sys.argv[2], float(sys.argv[3])
    lines = open(src, encoding="utf-8").read().splitlines()

    open_re = re.compile(r'<body\s+name="([^"]+)"')
    calf_re = re.compile(r"^(FL|FR|RL|RR)_calf$")
    out: list[str] = []
    stack: list[str] = []  # body-name stack
    added: list[str] = []

    for line in lines:
        opens = open_re.search(line)
        # Body open tags in these models are single-line and end with ">".
        if opens and not line.rstrip().endswith("/>"):
            stack.append(opens.group(1))
            out.append(line)
            continue
        if "</body>" in line and stack:
            name = stack[-1]
            m = calf_re.match(name)
            if m:
                indent = " " * (len(line) - len(line.lstrip()) + 2)
                leg = m.group(1)
                out.append(
                    f'{indent}<body name="{leg}_foot" pos="0 0 -{z:g}">'
                    f'<inertial pos="0 0 0" mass="1e-6" '
                    f'diaginertia="1e-9 1e-9 1e-9"/></body>'
                )
                added.append(f"{leg}_foot")
            stack.pop()
            out.append(line)
            continue
        out.append(line)

    if len(added) != 4:
        raise SystemExit(f"expected 4 calf bodies, augmented {len(added)}: {added}")

    text = "\n".join(out) + "\n"
    text = re.sub(r'<mujoco model="([^"]+)"', r'<mujoco model="\1_mocap"', text, count=1)
    open(dst, "w", encoding="utf-8").write(text)
    print(f"wrote {dst}: added foot bodies {', '.join(added)}")


if __name__ == "__main__":
    main()
