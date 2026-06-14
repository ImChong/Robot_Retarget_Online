# Robot Retarget Online · 在线人形机器人动作重定向

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live-brightgreen?logo=github)](https://imchong.github.io/Robot_Retarget_Online/)
[![Deploy to GitHub Pages](https://github.com/ImChong/Robot_Retarget_Online/actions/workflows/deploy.yml/badge.svg)](https://github.com/ImChong/Robot_Retarget_Online/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

在线地址：<https://imchong.github.io/Robot_Retarget_Online/>

Browser-based humanoid motion retargeting — a pure-frontend port of
[GMR (General Motion Retargeting)](https://github.com/YanjieZe/GMR) that runs
entirely in your browser via the official
[MuJoCo WebAssembly bindings](https://github.com/google-deepmind/mujoco/tree/main/wasm).
No backend, no installation.

纯前端实现的人形机器人动作重定向工具：BVH 动捕预览 → 重定向参数配置 → 机器人动作预览与导出，
全部计算（含 MuJoCo 正运动学/雅可比与微分 IK）在浏览器内完成。

## Pages · 功能页面

| Page | 功能 |
| --- | --- |
| **BVH Viewer** | BVHView 风格的动捕预览：拖拽打开 `.bvh`、胶囊体骨架渲染、播放/拖动时间轴/变速、关节层级树与关节信息；**视频生成 BVH（浏览器内 MediaPipe 姿态估计，实验性）** |
| **Retarget Config** | 机器人选择（Unitree G1 / Booster T1）、IK 关键点映射表（两阶段权重/偏移）、人体缩放表、求解器参数；配置 JSON 与 GMR `ik_config` 双向兼容 |
| **Retarget Preview** | 一键重定向（带进度）、机器人动作回放、人体关键点叠加对比、逐帧误差曲线、导出 NPZ / CSV / JSON |

## How it works · 技术要点

- **Algorithm**: faithful TypeScript port of GMR's two-stage differential IK
  (`motion_retarget.py`) — per-body scaling about the root, local-frame
  pos/rot offsets, damped weighted Gauss-Newton steps with exact MuJoCo body
  Jacobians (`mj_jacBody`), `mj_integratePos` for the floating base, joint
  range clamping, per-stage convergence loop (1 + up to 10 iterations, stop
  when error improvement < 1e-3 — same defaults as GMR).
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

## Deploy

Pushes to `main` build and deploy via GitHub Actions
(`.github/workflows/deploy.yml`). One-time setup: repository **Settings →
Pages → Source: GitHub Actions**.

## Roadmap

Full plan of record in **[`ROADMAP.md`](ROADMAP.md)**. Headlines:

- [x] Phase 1 — GMR online (BVH/LAFAN1 → Unitree G1, Booster T1), parity-validated
- [x] Video → BVH input (experimental, in-browser MediaPipe pose capture)
- [ ] More GMR robots (assets are drop-in: `public/robots/` + manifest entry)
- [ ] Phase 2 — [holosoma](https://github.com/amazon-far/holosoma) as a second pluggable engine
- [ ] SMPL-X / AMASS input (user-supplied body model; deferred for licensing)

## Credits & licenses

- [GMR](https://github.com/YanjieZe/GMR) (MIT) — retargeting algorithm,
  ik_configs and robot model assets (`public/robots/`, original sources:
  Unitree, Booster Robotics).
- [MuJoCo](https://github.com/google-deepmind/mujoco) (Apache-2.0) — physics
  & WASM bindings (`mujoco-js`).
- [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe)
  (Apache-2.0) — in-browser pose estimation for the experimental video → BVH feature.
- [BVHView](https://github.com/orangeduck/BVHView) — UI/rendering inspiration.
- Site layout inspired by
  [RL_Sim2Sim_Demo_Website](https://github.com/ImChong/RL_Sim2Sim_Demo_Website).

Code in this repository is released under the MIT License (see `LICENSE`).
