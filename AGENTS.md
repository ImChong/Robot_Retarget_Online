# AGENTS.md

## Project roadmap · 项目规划

**Read [`ROADMAP.md`](ROADMAP.md) before planning new work** — it is the plan of
record (Phase 1 = GMR online, done; Phase 2 = holosoma as a second pluggable
engine; SMPL-X/AMASS input as a deferred parallel track) and lists the cheap
near-term extensions (more GMR robots, a `RetargetEngine` interface). Keep it in
sync when milestones land.

## Cursor Cloud specific instructions

This is a 100% browser-based, backend-free app (Vite + Vue 3 + TypeScript). There is **no server, database, or external service** — all computation (MuJoCo physics/IK via WASM) runs client-side. The only "service" is the Vite dev/preview server.

Standard commands live in `package.json` `scripts` and `README.md` (`## Develop`). Quick reference:

- Dev server: `npm run dev` → http://localhost:3000 (port pinned in `vite.config.ts`).
- Tests: `npm test` (Vitest, runs MuJoCo WASM in Node).
- Type check: `npm run typecheck` (`vue-tsc --noEmit`). There is **no ESLint/Prettier lint script**; typecheck is the closest gate.
- Build: `npm run build` → `dist/`; serve with `npm run preview` (port 4173).

Non-obvious caveats:

- `tests/robots/parity/*.test.ts` are **skipped by default** — they need Python-generated GMR reference JSON (`python3 scripts/gmr_reference_all.py`). This is optional validation; skipped is the expected state.
- `scripts/e2e_smoke.mjs` is an optional headless smoke test that needs Chromium and a prior `npm run build`; it is not part of `npm test`.
- `scripts/webkit_preview_verify.mjs` drives the full workflow on an emulated iPhone in Playwright's WebKit and guards the touch contract: every control must resolve to `touch-action: manipulation` (otherwise Safari holds the click back for double-tap-to-zoom) and have a ≥44×44pt effective hit area. Run it against a live dev/preview server (`node scripts/webkit_preview_verify.mjs --url http://localhost:3000`) after any change to the app chrome. It needs `npx playwright-core install webkit` (plus `install-deps webkit` on Linux) and is not part of `npm test`.
- `scripts/mobile_touch_verify.mjs` covers what the WebKit script cannot: the behaviours that only break on a device dispatching **no compatibility mouse events** for a tap (iOS 26.6 — see `src/lib/tapFallback.ts`). It runs the workflow twice on a phone-sized Chromium, once with every trusted mouse event swallowed before the page sees it and once untouched, and checks that the metrics panel scrolls to the whole chart, that a tap beside the side panel closes it, and that the history dropdown opens and dismisses. Run it against a live server (`node scripts/mobile_touch_verify.mjs --url http://localhost:3000`) after touching the tap fallback, the side panel or the metrics layout; it needs only the bundled Chromium and is not part of `npm test`.
- `mujoco-js` ships an ~11 MB WASM bundle (excluded from Vite dep optimization). The build prints a `Module "module" has been externalized for browser compatibility` warning from `mujoco_wasm.js` and a large-chunk note — both are expected, not errors.
- To exercise the app end-to-end without uploading files: BVH Viewer → "Loading example actions" → "Walk (sample)", then Retarget Preview → "Start redirection". Bundled samples live in `public/sample_motions/`. For the quadruped path pick a "Dog … (Quadruped)" sample instead — Retarget Config then auto-selects Unitree Go2 and greys out the humanoid robots. `?quadruped=0` on the URL hides the quadruped entries for that page load (`src/lib/features.ts`).
- `npm run build` gzips the robot meshes in `dist/robots/` (`scripts/compressRobotMeshes.ts`): GitHub Pages serves `.STL` / `.obj` uncompressed, so `dist/` ships `<mesh>.gz` instead (~625 MB → ~172 MB) and `dist/robots/manifest.json` lists them under `gzFiles`; the loader (`src/lib/mujoco/runtime.ts`) inflates them with `DecompressionStream`. `public/` keeps the raw files, so dev, tests and the parity scripts are unaffected.
- The BVH page creates its WebGL viewport on demand (motion loaded, or pointer over the viewport): the empty landing page has no `<canvas>`. Scripts should wait for `.empty-hint` or a loaded motion, not `canvas`. All three viewports render on demand — after changing the scene in place, call `SceneManager.invalidate()` (or return `true` from an `onTick` callback).
- Icons are Phosphor path strings (`src/lib/iconPaths.ts`), generated from `@phosphor-icons/core` by `node scripts/gen-icons.mjs`; add an icon to its `ICONS` table and re-run it.
- Vuetify components are auto-imported by `vite-plugin-vuetify`, and its SASS is compiled with `src/styles/vuetify-settings.scss`, which turns off the breakpoint variants of the utility classes (`ma-sm-2`, `d-md-flex`, …) — use the base classes or scoped CSS media queries.
- `scripts/e2e_gallery.mjs` drives the Robot Description Gallery picker (Retarget Config → "Pick URDF from Gallery") against a live server: built-in G1 links to the gallery, gallery G1 → walk, gallery Go2 (Collada meshes) → dog walk. Unlike everything else here it needs **network access** (imchong.github.io + cdn.jsdelivr.net; honours `HTTPS_PROXY`). `--humanoid` / `--quadruped` pick other gallery cards by name. Not part of `npm test`; `tests/gallery.test.ts` covers the same code offline.
- `scripts/e2e_quadruped.mjs` is a headless Chromium check of the quadruped flow (sample menu → auto robot switch → retarget on Go2 / A1 for all three dog clips → NPZ export → switch back to humanoid). It needs a prior `npm run build`, writes screenshots + `summary.json` to `E2E_OUT` (default `/tmp/e2e_quadruped`), and is not part of `npm test`.

## UI change verification (required)

Any change that affects layout, styling, or visible UI behavior **must** be verified in the browser with a **screenshot** before the task is considered done.

1. Start the app (`npm run dev`) and open http://localhost:3000.
2. Navigate to the affected view(s) and exercise the changed control(s).
3. Capture at least one screenshot showing the result (use the `computerUse` subagent or `RecordScreen` when appropriate).
4. Include the screenshot in the PR walkthrough or final summary so reviewers can see the before/after or fixed state.

Do not rely on code review or unit tests alone for UI fixes — visual confirmation is mandatory.
