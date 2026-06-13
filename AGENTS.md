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
- `mujoco-js` ships an ~11 MB WASM bundle (excluded from Vite dep optimization). The build prints a `Module "module" has been externalized for browser compatibility` warning from `mujoco_wasm.js` and a large-chunk note — both are expected, not errors.
- To exercise the app end-to-end without uploading files: BVH Viewer → "Loading example actions" → "Walk (sample)", then Retarget Preview → "Start redirection". Bundled samples live in `public/sample_motions/`.

## UI change verification (required)

Any change that affects layout, styling, or visible UI behavior **must** be verified in the browser with a **screenshot** before the task is considered done.

1. Start the app (`npm run dev`) and open http://localhost:3000.
2. Navigate to the affected view(s) and exercise the changed control(s).
3. Capture at least one screenshot showing the result (use the `computerUse` subagent or `RecordScreen` when appropriate).
4. Include the screenshot in the PR walkthrough or final summary so reviewers can see the before/after or fixed state.

Do not rely on code review or unit tests alone for UI fixes — visual confirmation is mandatory.
