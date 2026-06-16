# Robot Retarget Online · 在线人形机器人动作重定向

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live-brightgreen?logo=github)](https://imchong.github.io/Robot_Retarget_Online/)
[![Deploy to GitHub Pages](https://github.com/ImChong/Robot_Retarget_Online/actions/workflows/deploy.yml/badge.svg)](https://github.com/ImChong/Robot_Retarget_Online/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

在线地址：<https://imchong.github.io/Robot_Retarget_Online/>

Browser-based humanoid motion retargeting — a pure-frontend port of
[GMR (General Motion Retargeting)](https://github.com/YanjieZe/GMR) that runs
entirely in your browser via the official
[MuJoCo WebAssembly bindings](https://github.com/google-deepmind/mujoco/tree/main/wasm).
No backend, no installation. Two retargeting engines are selectable in the UI:
**GMR** and **OmniRetarget** (an in-browser
[interaction-mesh](https://omni-retarget.github.io/) adaptation layered on GMR's
solver — preserves the relative structure between keypoints).

纯前端实现的人形机器人动作重定向工具：BVH 动捕预览 → 重定向参数配置 → 机器人动作预览与导出，
全部计算（含 MuJoCo 正运动学/雅可比与微分 IK）在浏览器内完成。

## Pages · 功能页面

| Page | 功能 |
| --- | --- |
| **BVH Viewer** | BVHView 风格的动捕预览：拖拽打开 `.bvh`、胶囊体骨架渲染、播放/拖动时间轴/变速、关节层级树与关节信息；**视频生成 BVH（浏览器内 MediaPipe 姿态估计，实验性）** |
| **Retarget Config** | 引擎选择（GMR / OmniRetarget）、机器人选择（Unitree G1 / Booster T1 等）、IK 关键点映射表（两阶段权重/偏移）、人体缩放表、求解器参数；配置 JSON 与 GMR `ik_config` 双向兼容 |
| **Retarget Preview** | 引擎切换、一键重定向（带进度）、机器人动作回放、人体关键点叠加对比、逐帧误差曲线、导出 NPZ / CSV / JSON |

## How it works · 技术要点

- **Algorithm (GMR)**: faithful TypeScript port of GMR's two-stage differential
  IK (`motion_retarget.py`) — per-body scaling about the root, local-frame
  pos/rot offsets, damped weighted Gauss-Newton steps with exact MuJoCo body
  Jacobians (`mj_jacBody`), `mj_integratePos` for the floating base, joint
  range clamping, per-stage convergence loop (1 + up to 10 iterations, stop
  when error improvement < 1e-3 — same defaults as GMR).
- **Algorithm (OmniRetarget)**: the same solver plus an interaction-mesh
  objective (`src/lib/retarget/omniEngine.ts`). Each frame builds a k-nearest-
  neighbour graph over the (scaled) human keypoints and adds a soft Gauss-Newton
  term driving the robot's Laplacian coordinates `δ_i = p_i − Σ_j w_ij p_j`
  (translation-invariant) onto the human's, preserving relative limb structure.
  Tunable `meshWeight` / `meshNeighbors`; `meshWeight = 0` reduces exactly to GMR.
- **BVH pipeline**: LAFAN1-convention loader (matches GMR's `lafan_vendor`):
  euler→quat per channel order, FK, Y-up→Z-up, cm→m, virtual
  `LeftFootMod`/`RightFootMod` joints.
- **Video → BVH (experimental)**: in-browser MediaPipe Pose
  (`@mediapipe/tasks-vision`, Apache-2.0, lazy-loaded) estimates 33 3D
  landmarks/frame; a position→rotation solver (`src/lib/mocap/`) maps them onto
  the fixed LAFAN1 skeleton — only bone *directions* are used (lengths stay at
  the rest offsets), with One-Euro smoothing — emitting a BVH that flows through
  the same loader and retargeting. Draft quality; the video never leaves the
  browser. 浏览器内单目动捕：MediaPipe 关键点 → 旋转求解到 LAFAN1 骨架，复用同一管线。
- **Rendering**: three.js (Z-up), robot meshes built from the compiled MuJoCo
  model, checkerboard floor + soft shadows for contact/foot-skate inspection
  (BVHView-inspired).
- **Export**: NPZ with GMR-compatible keys (`fps`, `root_pos`,
  `root_rot` (xyzw), `dof_pos`); `scripts/npz_to_pkl.py` converts to the exact
  GMR pickle format. CSV/JSON also available.

## Validation · 数值验证

The web engine is validated against the original Python GMR
(`tests/parity.test.ts` + `scripts/gmr_reference.py`): on the bundled walk
sample retargeted to Unitree G1, frame-0 preprocessed IK targets match GMR to
~1e-9, and the full-motion output agrees within **0.019 rad DoF RMSE / 0.27 cm
root RMSE** (differences stem from the damped Gauss–Newton step vs. mink's
daqp QP). Throughput in-browser is ~700–800 frames/s vs ~34 frames/s for the
Python pipeline on the same machine.

```bash
# regenerate the reference and run the parity test locally
python3 scripts/gmr_reference.py public/sample_motions/walk.bvh unitree_g1 /tmp/gmr_ref_walk_g1.json
npx vitest run tests/parity.test.ts
```

## Develop

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # unit + engine integration tests (runs MuJoCo WASM in Node)
npm run typecheck
npm run build      # production build to dist/
node scripts/e2e_smoke.mjs   # headless full-pipeline smoke test (needs chromium)
```

### Sample motions

`public/sample_motions/*.bvh` are **trimmed clips from the
[Ubisoft LAFAN1](https://github.com/ubisoft/ubisoft-laforge-animation-dataset)
dataset (non-commercial license): **walk, run, dance, fall & get up, jumps**
(60 s each). Regenerate from a local LAFAN1 zip via
`python3 scripts/prepare_lafan_samples.py`.

The legacy procedural generator (`scripts/gen_sample_bvh.py`) is kept for
reference only. For the full dataset, download LAFAN1 and drop any `.bvh` into
the app.

## Quadruped retargeting · 四足机器人重定向

Beyond humanoids, the same keypoint differential-IK engine retargets **animal
mocap onto quadruped robots**. This follows the most mature open-source
quadruped retargeting work — Peng et al.'s
[**motion_imitation**](https://github.com/erwincoumans/motion_imitation)
("Learning Agile Robotic Locomotion Skills by Imitating Animals", RSS 2020):
pick a small set of source keypoints on the animal (root + four feet) and the
corresponding target keypoints on the robot, then solve IK. GMR's two-stage
solver already does exactly this, so quadruped support is a config + asset
drop-in rather than a new algorithm. Related references surveyed:
[Tencent Robotics X "Lifelike Agility and Play"](https://github.com/Tencent-RoboticsX/lifelike-agility-and-play)
(Nature MI 2024, real Labrador BVH) and
[pan-motion-retargeting](https://github.com/hlcdyy/pan-motion-retargeting) (TVCG 2023).

复用同一套关键点微分 IK 引擎，将**动物动捕重定向到四足机器人**。方法对齐当前最成熟的开源四足
重定向工作（motion_imitation，"模仿动物"）：在动物身上选取少量关键点（躯干 + 4 只脚）与机器人
对应点，求解 IK。GMR 两阶段求解器本就如此，因此四足支持只需新增配置与资产。

| | |
| --- | --- |
| **Source motion** | Real **Labrador retriever** mocap (`.bvh`) from Tencent's *Lifelike Agility* dataset (MIT), trimmed/downsampled to 30 fps: `dog_walk`, `dog_run`, `dog_idle`. 61-joint quadruped skeleton — flows through the same BVH loader (generic FK; human foot augmentation auto-skips). |
| **Robots** | **Unitree Go2** and **Unitree A1** (12 DoF), real MJCF + meshes from [MuJoCo Menagerie](https://github.com/google-deepmind/mujoco_menagerie) (Unitree BSD-3). A `*_mocap.xml` variant adds four massless `*_foot` keypoint bodies at the foot tips (no added DoF). Canonical URDFs are also included under `public/robots/<id>/urdf/` as reference. |
| **Mapping** | `bvh_quadruped_to_unitree_{go2,a1}.json`: `base/trunk ← b_Hips` (orientation + position) and `FL/FR/RL/RR_foot ← b_{Left,Right}Hand / b_{Left,Right}Toe` (position). A constant trunk-frame offset (clip-independent) and a 0.5 body scale fit the Labrador onto the smaller robots. |

### Hidden preview · 暂时隐藏（URL 开关）

The quadruped workflow is **hidden in the public UI by default** (Go2 / A1 in the
robot dropdown and the **Dog … (Quadruped)** sample clips). The MJCF assets,
dog BVH samples, and retargeting configs still ship in the build — only the UI
entry points are gated (`src/lib/features.ts`).

四足重定向流程在公开站点上**默认隐藏**（机器人下拉中的 Go2 / A1，以及示例动作里的狗动捕
条目）。相关资产与引擎代码仍随构建发布，只是 UI 入口被关掉。

**Reveal it** by opening the site with a `quadruped` query parameter. The flag is
read from the URL on each page load only (not persisted — a prior test visit
with `?quadruped=1` will not keep the menu visible on later visits without the
parameter):

**启用方式**：在 URL 中带上 `quadruped` 查询参数后打开页面。每次加载只读 URL
（不写入 `localStorage`；之前用过 `?quadruped=1` 测试，之后不带参数打开也不会
一直显示四足入口）：

| | URL |
| --- | --- |
| **Production 线上** | <https://imchong.github.io/Robot_Retarget_Online/?quadruped=1> |
| **Local dev 本地** | <http://localhost:3000/?quadruped=1> |
| **Hash-router form** (also works) | `…/Robot_Retarget_Online/#/bvh?quadruped=1` |

After enabling, reload if needed, then in *BVH Viewer* pick a **Dog …
(Quadruped)** sample and in *Retarget Config* choose **Unitree Go2/A1**.
启用后若菜单未出现可刷新页面；在 *BVH Viewer* 加载 **Dog … (Quadruped)** 示例，
再在 *Retarget Config* 选择 **Unitree Go2/A1**。

Validated headless: across walk/run/idle the robot stands at ≈0.28 m with the
four feet tracked to **~1–2 cm** and the trunk within ~10° of the dog's
(faithful pitch). Reproduce:

```bash
# trimmed dog clips from a local checkout of the Lifelike-Agility raw_mocap_data
python3 scripts/prepare_dog_samples.py --raw /path/to/raw_mocap_data
# regenerate the foot-keypoint robot variants from a Menagerie checkout
python3 scripts/add_quadruped_foot_sites.py go2.xml go2_mocap.xml 0.213
npx vitest run tests/quadruped.test.ts
```

## Deploy

Pushes to `main` build and deploy via GitHub Actions
(`.github/workflows/deploy.yml`). One-time setup: repository **Settings →
Pages → Source: GitHub Actions**.

## Roadmap

Full plan of record in **[`ROADMAP.md`](ROADMAP.md)**. Headlines:

- [x] Phase 1 — GMR online (BVH/LAFAN1 → Unitree G1, Booster T1), parity-validated
- [x] Phase 2 — pluggable engines: **OmniRetarget** (in-browser interaction-mesh) selectable alongside GMR
- [x] Video → BVH input (experimental, in-browser MediaPipe pose capture)
- [x] **Quadruped retargeting** — dog mocap (BVH) → Unitree Go2 / A1 via keypoint IK ([motion_imitation](https://github.com/erwincoumans/motion_imitation)-style)
- [ ] More GMR robots (assets are drop-in: `public/robots/` + manifest entry)
- [ ] [holosoma](https://github.com/amazon-far/holosoma) as a third, trajectory-level engine (heavier; backend TBD)
- [ ] SMPL-X / AMASS input (user-supplied body model; deferred for licensing)

## Credits & licenses

- [GMR](https://github.com/YanjieZe/GMR) (MIT) — retargeting algorithm,
  ik_configs and robot model assets (`public/robots/`, original sources:
  Unitree, Booster Robotics).
- [motion_imitation](https://github.com/erwincoumans/motion_imitation)
  (Apache-2.0) — "Learning Agile Robotic Locomotion Skills by Imitating Animals";
  the root + four-feet keypoint-IK scheme adopted for quadruped retargeting.
- [Lifelike Agility and Play](https://github.com/Tencent-RoboticsX/lifelike-agility-and-play)
  (Tencent Robotics X, MIT) — source of the bundled Labrador retriever dog mocap
  (`public/sample_motions/dog_*.bvh`, trimmed/downsampled).
- [MuJoCo Menagerie](https://github.com/google-deepmind/mujoco_menagerie) —
  Unitree **Go2** / **A1** MJCF and meshes (Unitree BSD-3, see each robot's
  `LICENSE`); canonical URDFs from
  [unitree_ros](https://github.com/unitreerobotics/unitree_ros).
- [OmniRetarget](https://omni-retarget.github.io/) — interaction-mesh /
  interaction-preserving retargeting idea adapted for the in-browser
  OmniRetarget engine. The interaction-mesh / Laplacian formulation follows Ho,
  Komura & Tai, "Spatial Relationship Preserving Character Motion Adaptation"
  (SIGGRAPH 2010).
- [MuJoCo](https://github.com/google-deepmind/mujoco) (Apache-2.0) — physics
  & WASM bindings (`mujoco-js`).
- [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe)
  (Apache-2.0) — in-browser pose estimation for the experimental video → BVH feature.
- [BVHView](https://github.com/orangeduck/BVHView) — UI/rendering inspiration.
- Site layout inspired by
  [RL_Sim2Sim_Demo_Website](https://github.com/ImChong/RL_Sim2Sim_Demo_Website).

Code in this repository is released under the MIT License (see `LICENSE`).
