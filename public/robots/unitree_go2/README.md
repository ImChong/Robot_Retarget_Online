# Unitree Go2 (quadruped)

Assets for the quadruped retargeting target.

| File | Source | License |
| --- | --- | --- |
| `go2.xml`, `assets/*.obj` | [MuJoCo Menagerie · `unitree_go2`](https://github.com/google-deepmind/mujoco_menagerie/tree/main/unitree_go2) | Unitree BSD-3 — see `LICENSE` |
| `go2_mocap.xml` | derived from `go2.xml` by `scripts/add_quadruped_foot_sites.py` | same |
| `urdf/go2_description.urdf` | [unitree_ros · `go2_description`](https://github.com/unitreerobotics/unitree_ros) | BSD-3 |

`go2_mocap.xml` is the model the app loads (referenced from `manifest.json`). It
is `go2.xml` plus four massless `*_foot` bodies at the foot tips
(`pos="0 0 -0.213"` under each `*_calf`) so the retargeting engine has explicit
foot keypoints to track. The bodies have no joint, so the robot's 12-DoF
kinematics and dynamics are unchanged. The URDF is included as a kinematic
reference (its `package://…/dae` meshes are not bundled).
