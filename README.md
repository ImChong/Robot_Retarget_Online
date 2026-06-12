# Robot Retarget Online · 在线人形机器人动作重定向

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
| **BVH Viewer** | BVHView 风格的动捕预览：拖拽打开 `.bvh`、胶囊体骨架渲染、播放/拖动时间轴/变速、关节层级树与关节信息 |
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

`public/sample_motions/*.bvh` are procedurally generated, license-free clips
with a LAFAN1-compatible skeleton (`scripts/gen_sample_bvh.py`). For real
mocap, get LAFAN1 from
[ubisoft-laforge-animation-dataset](https://github.com/ubisoft/ubisoft-laforge-animation-dataset)
(non-commercial license — not bundled here) and drop any `.bvh` into the app.

## Deploy

Pushes to `main` build and deploy via GitHub Actions
(`.github/workflows/deploy.yml`). One-time setup: repository **Settings →
Pages → Source: GitHub Actions**.

## Roadmap

- [x] Phase 1 — GMR online (BVH/LAFAN1 → Unitree G1, Booster T1)
- [ ] More GMR robots (assets are drop-in: `public/robots/` + manifest entry)
- [ ] SMPL-X / AMASS input (user-supplied body model)
- [ ] Phase 2 — [holosoma](https://github.com/amazon-far/holosoma) retargeting engine

## Credits & licenses

- [GMR](https://github.com/YanjieZe/GMR) (MIT) — retargeting algorithm,
  ik_configs and robot model assets (`public/robots/`, original sources:
  Unitree, Booster Robotics).
- [MuJoCo](https://github.com/google-deepmind/mujoco) (Apache-2.0) — physics
  & WASM bindings (`mujoco-js`).
- [BVHView](https://github.com/orangeduck/BVHView) — UI/rendering inspiration.
- Site layout inspired by
  [RL_Sim2Sim_Demo_Website](https://github.com/ImChong/RL_Sim2Sim_Demo_Website).

Code in this repository is released under the MIT License (see `LICENSE`).
