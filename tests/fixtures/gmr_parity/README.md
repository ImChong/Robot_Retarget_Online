# GMR parity fixtures (optional)

Per-robot BVH parity tests read JSON references from this directory:

- `walk_<robot_id>.json` — output of `scripts/gmr_reference.py`

Generate all selectable robots (120 frames of `walk.bvh` by default):

```bash
# needs Python GMR deps + clone at /tmp/gmr (or set GMR_ROOT)
python3 scripts/gmr_reference_all.py
```

Tests in `tests/robots/parity/` are **skipped** when the matching fixture is absent (normal in CI).
Legacy path `/tmp/gmr_ref_walk_g1.json` still works for `unitree_g1`.
