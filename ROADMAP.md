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
MuJoCo-WASM differential IK). Phase 2 makes the engine **pluggable** and ships
**OmniRetarget** as a second, user-selectable engine (an in-browser
interaction-mesh adaptation layered on GMR's solver); **holosoma** remains a
heavier future option behind the same `RetargetEngine` interface. SMPL-X / AMASS
input is a parallel input-format track deferred for licensing reasons.

纯前端、无后端的人形机器人**动作重定向**网页应用。Phase 1 已把 **GMR** 引擎完整搬进浏览器
（BVH → 人形机器人，基于 MuJoCo-WASM 的微分 IK）。Phase 2 把引擎做成**可插拔**，并接入
**OmniRetarget** 作为第二个可在 UI 切换的引擎（在 GMR 求解器之上叠加交互网格约束的浏览器内实现）；
**holosoma** 作为更重的方案保留在同一套 `RetargetEngine` 接口之后。SMPL-X / AMASS 输入是一条
独立的输入格式分支，因许可证原因后置。

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

Robots shipped today / 当前已支持机器人 (BVH/LAFAN1, selectable in UI): `unitree_g1`,
`unitree_g1_with_hands`, `booster_t1_29dof`, `stanford_toddy`, `fourier_n1`,
`engineai_pm01`, `pal_talos` (+ quadrupeds `unitree_go2` / `unitree_a1` behind the
`?quadruped=1` URL flag). A further 10 GMR robots (`unitree_h1`, `unitree_h1_2`,
`kuavo_s45`, `hightorque_hi`, `berkeley_humanoid_lite`, `booster_k1`,
`pnd_adam_lite`, `tienkung`, `fourier_gr3`, `booster_t1`) have no `bvh_lafan1`
config — they are keyed to SMPL-X joint names and surface via the **SMPL-X input
track** below (registered in `manifest.json` + `defaults.ts`, shown only for
SMPL-X motion). `galaxea_r1pro` stays out: its `smplx_to_r1pro` config references
bodies absent from the bundled MJCF.

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

## Phase 2 — pluggable engines · 可插拔引擎

The engine is now selectable behind one UI via a `RetargetEngine` interface.
**OmniRetarget** ships as the second engine; **holosoma** is kept as a heavier
future option behind the same interface.

引擎已通过 `RetargetEngine` 接口在同一套 UI 后面可切换。**OmniRetarget** 作为第二个引擎交付；
**holosoma** 作为更重的方案保留在同一接口之后。

### OmniRetarget (interaction mesh) · OmniRetarget（交互网格）  ✅ Shipped / 已交付

A per-frame, in-browser adaptation of
[OmniRetarget](https://omni-retarget.github.io/)'s interaction-preserving idea,
layered directly on GMR's two-stage differential IK. Each frame it builds a
small k-nearest-neighbour **interaction mesh** over the (scaled) human keypoints
and adds a soft Gauss-Newton objective driving the robot's **Laplacian
coordinates** `δ_i = p_i − Σ_j w_ij p_j` (translation-invariant — local *shape*,
not absolute placement) onto the human's. This preserves the relative structure
between keypoints, curbing self-penetration and limb-shape distortion, and
matters most on noisy / self-contact-heavy motion. With `meshWeight = 0` it
reduces **exactly** to GMR (asserted in `tests/omni.test.ts`).

在 GMR 两阶段微分 IK 之上的浏览器内逐帧实现：每帧在（缩放后的）人体关键点上构建 k 近邻**交互网格**，
增加一个软目标，使机器人的**拉普拉斯坐标** `δ_i = p_i − Σ_j w_ij p_j`（平移不变，编码局部*形状*）
逼近人体的，从而保持关键点间的相对结构、抑制自穿插与肢体形变。`meshWeight = 0` 时**精确**退化为 GMR。

- Files: `src/lib/retarget/omniEngine.ts` (engine + pure mesh helpers),
  `src/lib/retarget/engine.ts` (`accumulateExtraTerms` hook),
  `src/components/EngineToggle.vue` (UI), `tests/omni.test.ts`.
- Out of scope here (no objects/terrain in BVH input): object/scene interaction
  meshes and the trajectory-level contact/foot-skate optimization from the
  original paper. 输入中无物体/地形，故不含物体-场景交互网格与轨迹级接触/滑步优化。

### holosoma (future, heavier) · holosoma（更重的未来方案）

[holosoma](https://github.com/amazon-far/holosoma) is a trajectory-level
**convex optimization** (`cvxpy` + `torch`), heavier than GMR's per-frame IK, so
the in-browser story needs a decision:

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

- [x] Extract a **`RetargetEngine` interface** so engines are interchangeable
      behind the store/UI (`src/lib/retarget/types.ts`). The runner selects via
      `createEngine()` (`src/lib/retarget/runner.ts`); the store carries an
      `engine` field (`src/stores/retarget.ts`).
      已抽象出 `RetargetEngine` 接口，让引擎在 store/UI 后面可互换。
- [x] An engine picker (GMR / OmniRetarget) on the Config **and** Preview pages
      via `EngineToggle.vue`. 设置页与预览页均加入引擎选择器。

---

## Input formats: SMPL-X / AMASS · 输入格式：SMPL-X / AMASS  ✅ Shipped (parity pending) / 已交付（待对齐）

GMR already supports SMPL-X (AMASS, OMOMO). Shipped as an **independent track**
(it unlocks 10 of the staged robots above + the AMASS dataset in one shot):
upload a SMPL-X model `.npz` + AMASS motion `.npz` in the BVH Viewer, the clip
flows through the existing viewer → retarget path, and the SMPL-X robots surface
in the dropdown. The only remaining item is a GMR parity check. Notes:

GMR 本身已支持 SMPL-X（AMASS、OMOMO）。作为**独立分支**后置，因为：

- SMPL-X model files are **license-restricted and cannot be redistributed** —
  users must supply their own `.npz` body model.
  SMPL-X 模型文件**受许可证限制、禁止再分发**——需用户自备 `.npz`。
- Requires a frontend **LBS (linear blend skinning)** implementation to turn
  SMPL-X parameters into the joint keypoints GMR consumes — separable effort
  from the retargeting engines. 需在前端实现 **LBS** 把 SMPL-X 参数转成 GMR 所需关键点，
  与重定向引擎相互独立。

Scope / 范围:
- [x] **SMPL-X → keypoints core** (`src/lib/smplx/`): NPY/NPZ readers (`npy.ts`),
      body-model + AMASS-motion parsing (`model.ts`), shape→rest-joints + rigid
      kinematic-chain FK → GMR `HumanFrame`s in Z-up meters (`fk.ts`), and a
      one-shot `loadSmplxMotion()` (`index.ts`). Only the shape/skeleton terms
      (`v_template`, `shapedirs`, `J_regressor`, `kintree_table`) are needed — no
      mesh skinning, since pose blend shapes move vertices, not joints. Unit-tested
      on synthetic fixtures (`tests/smplx.test.ts`). 核心已落地并测试。
- [x] **End-to-end integration** proven in Node: synthetic SMPL-X → existing
      `runRetarget` → real Unitree **H1** via the bundled `smplx_to_h1.json`
      (`tests/smplxRetarget.test.ts`). 已验证可跑通到真实机器人 H1。
- [x] **UI/store wiring** (screenshot-verified per `AGENTS.md`): `SmplxImportDialog`
      (model `.npz` + motion `.npz`, kept in-memory, never bundled — handles the
      license restriction) feeds `motion.loadSmplx` → `smplxToBvh` → the same viewer
      → retarget path. A third `smplx` motion kind (`motionKind.ts`) filters the
      robot dropdown so the SMPL-X robots surface *only* for SMPL-X input
      (`RetargetConfigView.vue`).
- [x] **10 GMR SMPL-X robots registered** (`manifest.json` + `defaults.ts`): h1,
      h1_2, t1, kuavo, hi, bhl, k1, adam, tienkung, gr3 — each verified to load +
      retarget (`tests/smplxRetarget.test.ts`). `galaxea_r1pro` excluded (its config
      body names don't match the bundled MJCF).
- [ ] Parity vs Python GMR's SMPL-X path on a real body model (skipped-by-default,
      like the BVH parity test) to pin the Y-up→Z-up convention. 与 GMR SMPL-X 路径对齐。
- [ ] BVH (Nokov / Xsens / FBX-export) dialect support as opportunistic adds.

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
- [OmniRetarget](https://omni-retarget.github.io/) — interaction-mesh idea for
  the Phase 2 OmniRetarget engine (formulation after Ho et al., SIGGRAPH 2010).
- [holosoma](https://github.com/amazon-far/holosoma) (Apache-2.0) — future engine.
- [MuJoCo WASM](https://github.com/google-deepmind/mujoco/tree/main/wasm) (Apache-2.0).
- [BVHView](https://github.com/orangeduck/BVHView) — viewer/rendering inspiration.
