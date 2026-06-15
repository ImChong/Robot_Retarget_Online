# Unitree A1 (quadruped)

Assets for the quadruped retargeting target.

| File | Source | License |
| --- | --- | --- |
| `a1.xml`, `assets/*` | [MuJoCo Menagerie · `unitree_a1`](https://github.com/google-deepmind/mujoco_menagerie/tree/main/unitree_a1) | Unitree BSD-3 — see `LICENSE` |
| `a1_mocap.xml` | derived from `a1.xml` by `scripts/add_quadruped_foot_sites.py` | same |
| `urdf/a1.urdf` | [unitree_ros · `a1_description`](https://github.com/unitreerobotics/unitree_ros) | BSD-3 |

`a1_mocap.xml` is the model the app loads (referenced from `manifest.json`). It
is `a1.xml` plus four massless `*_foot` bodies at the foot tips
(`pos="0 0 -0.2"` under each `*_calf`) so the retargeting engine has explicit
foot keypoints to track. The bodies have no joint, so the robot's 12-DoF
kinematics and dynamics are unchanged. The URDF is included as a kinematic
reference (its `package://…` meshes are not bundled).
