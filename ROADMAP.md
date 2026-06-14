# Roadmap · 项目规划

> Future agents & contributors: this is the canonical plan of record for the
> project. Keep it in sync when milestones land. The short checklist in
> `README.md` mirrors the headline items here.
>
> 未来的 agent / 贡献者请注意：本文件是项目的权威规划。里程碑达成后请同步更新；
> `README.md` 里的简短清单只是这里头部条目的镜像。

## TL;DR · 一句话

A pure-frontend, backend-free humanoid **motion retargeting** web app. Phase 1
ships the **GMR** engine entirely in the browser (BVH → humanoid robot via
MuJoCo-WASM differential IK). Phase 2 adds **holosoma** as a second, pluggable
retargeting engine behind the same UI. SMPL-X / AMASS input is a parallel
input-format track deferred for licensing reasons.

纯前端、无后端的人形机器人**动作重定向**网页应用。Phase 1 已把 **GMR** 引擎完整搬进浏览器
（BVH → 人形机器人，基于 MuJoCo-WASM 的微分 IK）。Phase 2 在同一套 UI 后面接入 **holosoma**
作为第二个可插拔重定向引擎。SMPL-X / AMASS 输入是一条独立的输入格式分支，因许可证原因后置。

---

## Phase 1 — GMR online · GMR 在线版  ✅ Shipped / 已交付

Why first: BVH is natively supported, the algorithm is per-frame (portable to
JS), GMR is MIT-licensed, and all robot assets ship with the repo.

为什么先做：BVH 原生支持、算法逐帧（可移植到 JS）、GMR 是 MIT 协议、机器人资产齐全。

Milestones / 里程碑:

- [x] ① Scaffold + CI deploy · 脚手架 + GitHub Pages 自动部署
      (`vite.config.ts`, `.github/workflows/deploy.yml`)
- [x] ② BVH viewer page · BVH 预览页
      (`src/views/BvhViewerView.vue`, `src/lib/bvh/`, `src/lib/viewport/`)
- [x] ③ Robot load + render · 机器人加载与渲染
      (`src/lib/mujoco/runtime.ts`, `src/lib/mujoco/threeScene.ts`,
      `public/robots/` + `manifest.json`)
- [x] ④ TS retargeting engine — the hard part · TS 重定向引擎（核心难点）
      (`src/lib/retarget/engine.ts`: two-stage damped Gauss-Newton IK on exact
      `mj_jacBody` Jacobians, `mj_integratePos` floating base, joint clamping)
- [x] ⑤ Config page · 重定向设置页
      (`src/views/RetargetConfigView.vue`, `MappingTable.vue`; ik_config JSON
      import/export, byte-compatible with GMR)
- [x] ⑥ Preview / export page · 重定向预览 / 导出页
      (`src/views/RetargetPreviewView.vue`; NPZ/CSV/JSON, `scripts/npz_to_pkl.py`)
- [x] ⑦ Polish + parity report · 打磨 + 精度对齐报告
      (`tests/parity.test.ts` + `scripts/gmr_reference.py`: ~1e-9 on
      preprocessed targets, 0.019 rad DoF RMSE / 0.27 cm root RMSE vs Python GMR)

Delivered beyond the original plan / 超出原计划的部分:
mobile-responsive layout + drawers, dark/light theme, LAFAN1-derived sample
clips (walk / run / dance / fall & get-up / jumps), per-robot regression tests.

Robots shipped today / 当前已支持机器人: `unitree_g1`, `booster_t1_29dof`.

### Near-term, still Phase 1 · 近期（仍属 Phase 1）

- [ ] **More GMR robots** · 接入更多 GMR 机器人.
      Drop-in: copy the MJCF + only the XML-referenced meshes into
      `public/robots/<id>/`, add a `manifest.json` entry, and copy the matching
      `bvh_lafan1_to_<id>.json` ik_config into `src/lib/retarget/configs/` +
      register it in `src/lib/retarget/defaults.ts`. GMR provides 18 robots.
      Add a `tests/robots.test.ts` case (load + config-match + sample retarget).
- [ ] Optional QP-accurate solver · 可选的 QP 精确求解器.
      Current engine uses damped Gauss-Newton (close to, not identical to, mink's
      daqp QP). If higher fidelity is needed, evaluate an `osqp-wasm` path —
      this also de-risks Phase 2 option (a) below.

---

## Phase 2 — holosoma engine · holosoma 引擎  🔜 Planned / 计划中

Reuse the **same UI** and wire [holosoma](https://github.com/amazon-far/holosoma)
in as a **second retargeting engine** selectable alongside GMR. holosoma is a
trajectory-level **convex optimization** (`cvxpy` + `torch`), heavier than GMR's
per-frame IK, so the in-browser story needs a decision:

复用**同一套 UI**，把 [holosoma](https://github.com/amazon-far/holosoma) 作为**第二个
重定向引擎**与 GMR 并列可选。holosoma 是轨迹级**凸优化**（`cvxpy` + `torch`），比 GMR 的
逐帧 IK 重得多，因此浏览器侧需二选一：

- **(a) Frontend `osqp-wasm`** — reimplement holosoma's QP core in the browser.
  Fully static, no backend, consistent with Phase 1. Higher engineering cost;
  must reproduce the cost/constraint formulation faithfully.
  前端用 `osqp-wasm` 复刻其 QP 核心：纯静态、无后端，与 Phase 1 一致；工程量大，需忠实复现。
- **(b) Light backend** (e.g. Hugging Face Spaces) running the original Python
  for fidelity. Breaks the "no backend" property but guarantees parity and is
  faster to stand up. 轻后端（如 HF Spaces）跑原版 Python：保真、上手快，但打破"无后端"特性。

**Decision: defer until Phase 1 is accepted** (a vs b depends on accuracy needs
and whether we keep the pure-static deployment). 决策：**Phase 1 验收后再定**。

### Prep work that makes Phase 2 cheap · 让 Phase 2 更省力的前置

- [ ] Extract a **`RetargetEngine` interface** so GMR and holosoma are
      interchangeable behind the store/UI (input: human frames + config;
      output: per-frame robot state + diagnostics). Today the GMR engine is
      called directly in `src/lib/retarget/runner.ts` / `src/stores/retarget.ts`.
      抽象出 `RetargetEngine` 接口，让两个引擎在 store/UI 后面可互换。
- [ ] An engine picker in the Config page (GMR / holosoma). 设置页加引擎选择器。

---

## Input formats: SMPL-X / AMASS · 输入格式：SMPL-X / AMASS  ⏳ Phase 2+

GMR already supports SMPL-X (AMASS, OMOMO). Deferred as an **independent track**
because:

GMR 本身已支持 SMPL-X（AMASS、OMOMO）。作为**独立分支**后置，因为：

- SMPL-X model files are **license-restricted and cannot be redistributed** —
  users must supply their own `.npz` body model.
  SMPL-X 模型文件**受许可证限制、禁止再分发**——需用户自备 `.npz`。
- Requires a frontend **LBS (linear blend skinning)** implementation to turn
  SMPL-X parameters into the joint keypoints GMR consumes — separable effort
  from the retargeting engines. 需在前端实现 **LBS** 把 SMPL-X 参数转成 GMR 所需关键点，
  与重定向引擎相互独立。

Scope when picked up / 启动时的范围:
- [ ] User-supplied SMPL-X body-model upload (kept in-memory, never bundled).
- [ ] SMPL-X → keypoints (`src/lib/smplx/`), reuse `smplx_to_<robot>.json` configs.
- [ ] BVH (Nokov / Xsens / FBX-export) dialect support as opportunistic adds.

---

## Input formats: Motion JSON · 输入格式：Motion JSON  ✅ Shipped / 已交付

A format-agnostic input pipeline. The loader (`src/stores/motion.ts` →
`loadMotion`) auto-detects by file name/content and dispatches to either the BVH
parser or **Retarget Motion JSON** (`src/lib/motion/motionJson.ts`); both resolve
to the same `BvhAnim`, so the viewer, the LAFAN1 → human-frame conversion and the
retargeting engine consume either unchanged. Motion JSON is a clean,
self-describing schema (joint hierarchy + rest offsets + per-frame root
translation and **local quaternions** — no Euler channel-order ambiguity), is
fully self-contained (bundleable), and can be **exported** from the BVH Viewer
("Export as JSON").

格式无关的输入管线：`loadMotion` 按文件名/内容自动识别，分发到 BVH 解析器或 Motion JSON
加载器，二者都归一到同一 `BvhAnim`，下游（预览/转换/重定向）无需改动。Motion JSON 是干净、
自描述的骨架动画格式（层级 + 静止偏移 + 逐帧根平移与局部四元数），自包含可打包，并可从
BVH 预览页一键导出。

Files / 相关文件: `src/lib/motion/motionJson.ts` (format + parse/serialize),
`src/stores/motion.ts` (`loadMotion` dispatch), `scripts/gen_motion_json_samples.ts`
(bundled-sample generator), `tests/motionJson.test.ts`, `tests/samples.test.ts`
(JSON-sample retarget regression).

Bundled examples / 自带案例: `public/sample_motions/*.motion.json` —
`walk` (LAFAN1 walk re-encoded into the format), plus self-contained procedural
clips `wave` / `squat` / `tpose_calibration` authored on the LAFAN1 rest
skeleton. They preview upright and retarget to the robots like the BVH samples.

Next opportunistic adds / 后续机会式扩展: a generic per-frame **keypoint
trajectory** (CSV/JSON) that targets the human-frame contract directly (no
skeleton needed), and FBX import via three.js `FBXLoader` (needs a joint-name
remap to LAFAN1). 后续可加：直达 human-frame 契约的关键点轨迹（CSV/JSON）、以及经
three.js `FBXLoader` 的 FBX 导入（需关节名映射到 LAFAN1）。

---

## Input formats: Video → BVH · 输入格式：视频生成 BVH  ✅ Experimental / 实验性

In-browser monocular motion capture. MediaPipe Pose Landmarker
(`@mediapipe/tasks-vision`, Apache-2.0, dynamically imported; WASM runtime +
pose model served from the app's own origin — no third-party CDN) estimates 33
3D world landmarks per frame; a position→rotation solver maps
them onto the fixed LAFAN1 skeleton and emits a BVH that flows through the
normal `loadBvhText` → viewer → retargeting path. Only bone *directions* are
read (lengths stay at the rest offsets), with One-Euro smoothing + visibility
gating. Pure-frontend; the video never leaves the browser.

浏览器内单目动捕：MediaPipe 姿态估计 → 关键点 → 旋转求解到固定 LAFAN1 骨架，生成 BVH
复用既有 `loadBvhText` → 预览 → 重定向链路。仅取骨头方向（长度用静止骨架），含 One-Euro
平滑与置信度门控。保持纯前端，视频不离开浏览器。

Files / 相关文件: `src/lib/mocap/` (pipeline), `src/components/VideoToBvhDialog.vue`
(UI), `tests/mocap.test.ts`.

Known limits / 已知局限: monocular depth & axial twist are weak and global
translation is not recovered (motion plays in place) — **draft quality**.
Higher-fidelity world-grounded capture (e.g. WHAM / GVHMR / TRAM) needs a
backend + GPU and is out of scope for the static deployment; if a backend track
is ever opened (see Phase 2 option b), it could host such a model.
单目深度/自转弱、无全局位移（原地播放），为草稿级。更高保真的世界坐标动捕需后端+GPU，
超出纯静态部署范围。

---

## Architecture invariants · 架构约束（改动时请保持）

- **Pure frontend, no backend.** All compute (MuJoCo FK/Jacobian/IK) runs in the
  browser via `mujoco-js` WASM. The only "server" is Vite dev/preview.
  纯前端无后端，所有计算在浏览器内。
- **Static deploy to GitHub Pages** on push to `main`. Keep the 11 MB MuJoCo WASM
  chunk out of the first-paint modulepreload (lazy-loaded). 静态部署到 Pages。
- **GMR compatibility is a feature.** ik_config JSON and NPZ export stay
  byte/key-compatible with the GMR Python pipeline. 与 GMR 互通是卖点，勿破坏。
- See `AGENTS.md` for commands, caveats, and the mandatory UI-screenshot
  verification rule. 命令、注意事项、UI 截图验证规则见 `AGENTS.md`。

## Source projects · 参考项目

- [GMR](https://github.com/YanjieZe/GMR) (MIT) — Phase 1 engine + robot assets.
- [holosoma](https://github.com/amazon-far/holosoma) (Apache-2.0) — Phase 2 engine.
- [MuJoCo WASM](https://github.com/google-deepmind/mujoco/tree/main/wasm) (Apache-2.0).
- [BVHView](https://github.com/orangeduck/BVHView) — viewer/rendering inspiration.
