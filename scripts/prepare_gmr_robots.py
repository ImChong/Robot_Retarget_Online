#!/usr/bin/env python3
"""Sync GMR robot MJCF assets + ik_configs into this repo.

Usage:
  python3 scripts/prepare_gmr_robots.py [--gmr /path/to/GMR]
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROBOTS_DIR = ROOT / "public" / "robots"
CONFIGS_DIR = ROOT / "src" / "lib" / "retarget" / "configs"
DEFAULTS_TS = ROOT / "src" / "lib" / "retarget" / "defaults.ts"

ROBOTS: dict[str, dict] = {
    "unitree_g1": {
        "label": "Unitree G1 (29 DoF)",
        "xml": "assets/unitree_g1/g1_mocap_29dof.xml",
        "baseBody": "pelvis",
        "camDistance": 2.0,
        "bvh_config": "bvh_lafan1_to_g1.json",
    },
    "unitree_g1_with_hands": {
        "label": "Unitree G1 with Hands (29 DoF)",
        "xml": "assets/unitree_g1/g1_mocap_29dof_with_hands.xml",
        "baseBody": "pelvis",
        "camDistance": 2.0,
        "bvh_config": "bvh_lafan1_to_g1.json",
    },
    "unitree_h1": {
        "label": "Unitree H1",
        "xml": "assets/unitree_h1/h1.xml",
        "baseBody": "pelvis",
        "camDistance": 3.0,
        "smplx_config": "smplx_to_h1.json",
    },
    "unitree_h1_2": {
        "label": "Unitree H1-2",
        "xml": "assets/unitree_h1_2/h1_2_handless.xml",
        "baseBody": "pelvis",
        "camDistance": 3.0,
        "smplx_config": "smplx_to_h1_2.json",
    },
    "booster_t1": {
        "label": "Booster T1",
        "xml": "assets/booster_t1/T1_serial.xml",
        "baseBody": "Waist",
        "camDistance": 2.0,
        "smplx_config": "smplx_to_t1.json",
    },
    "booster_t1_29dof": {
        "label": "Booster T1 (29 DoF)",
        "xml": "assets/booster_t1_29dof/t1_mocap.xml",
        "baseBody": "Waist",
        "camDistance": 2.0,
        "bvh_config": "bvh_lafan1_to_t1_29dof.json",
    },
    "stanford_toddy": {
        "label": "Stanford ToddlerBot",
        "xml": "assets/stanford_toddy/toddy_mocap.xml",
        "baseBody": "waist_link",
        "camDistance": 1.0,
        "bvh_config": "bvh_lafan1_to_toddy.json",
    },
    "fourier_n1": {
        "label": "Fourier N1",
        "xml": "assets/fourier_n1/n1_mocap.xml",
        "baseBody": "base_link",
        "camDistance": 2.0,
        "bvh_config": "bvh_lafan1_to_n1.json",
    },
    "engineai_pm01": {
        "label": "EngineAI PM01",
        "xml": "assets/engineai_pm01/pm_v2.xml",
        "baseBody": "LINK_BASE",
        "camDistance": 2.0,
        "bvh_config": "bvh_lafan1_to_pm01.json",
    },
    "kuavo_s45": {
        "label": "Kuavo S45",
        "xml": "assets/kuavo_s45/biped_s45_collision.xml",
        "baseBody": "base_link",
        "camDistance": 3.0,
        "smplx_config": "smplx_to_kuavo.json",
    },
    "hightorque_hi": {
        "label": "HighTorque Hi (25 DoF)",
        "xml": "assets/hightorque_hi/hi_25dof.xml",
        "baseBody": "base_link",
        "camDistance": 2.0,
        "smplx_config": "smplx_to_hi.json",
    },
    "galaxea_r1pro": {
        "label": "Galaxea R1 Pro",
        "xml": "assets/galaxea_r1pro/r1_pro.xml",
        "baseBody": "torso_link4",
        "camDistance": 3.0,
        "smplx_config": "smplx_to_r1pro.json",
    },
    "berkeley_humanoid_lite": {
        "label": "Berkeley Humanoid Lite",
        "xml": "assets/berkeley_humanoid_lite/bhl_scene.xml",
        "baseBody": "imu_2",
        "camDistance": 2.0,
        "smplx_config": "smplx_to_bhl.json",
    },
    "booster_k1": {
        "label": "Booster K1",
        "xml": "assets/booster_k1/K1_serial.xml",
        "baseBody": "Trunk",
        "camDistance": 2.0,
        "smplx_config": "smplx_to_k1.json",
    },
    "pnd_adam_lite": {
        "label": "PND Adam Lite",
        "xml": "assets/pnd_adam_lite/scene.xml",
        "baseBody": "pelvis",
        "camDistance": 3.0,
        "smplx_config": "smplx_to_adam.json",
    },
    "tienkung": {
        "label": "Tienkung",
        "xml": "assets/tienkung/mjcf/tienkung.xml",
        "baseBody": "Base_link",
        "camDistance": 3.0,
        "smplx_config": "smplx_to_tienkung.json",
    },
    "pal_talos": {
        "label": "PAL Talos",
        "xml": "assets/pal_talos/talos.xml",
        "baseBody": "base_link",
        "camDistance": 3.0,
        "bvh_config": "bvh_to_talos.json",
    },
    "fourier_gr3": {
        "label": "Fourier GR3",
        "xml": "assets/fourier_gr3v2_1_1/mjcf/gr3v2_1_1_dummy_hand.xml",
        "baseBody": "base_link",
        "camDistance": 2.0,
        "smplx_config": "smplx_to_gr3.json",
    },
}

FILE_ATTR_RE = re.compile(r'\bfile="([^"]+)"')
INCLUDE_RE = re.compile(r'<include\s+file="([^"]+)"')
COMPILER_DIR_RE = {
    "meshdir": re.compile(r'<compiler\b[^>]*\bmeshdir="([^"]+)"'),
    "texturedir": re.compile(r'<compiler\b[^>]*\btexturedir="([^"]+)"'),
}


def parse_compiler_dirs(text: str) -> dict[str, str]:
    dirs: dict[str, str] = {}
    for key, pat in COMPILER_DIR_RE.items():
        m = pat.search(text)
        if m:
            dirs[key] = m.group(1)
    return dirs


def resolve_asset(base_dir: Path, ref: str, compiler_dirs: dict[str, str]) -> Path | None:
    ref_path = Path(ref)
    if ref_path.is_absolute():
        return ref_path if ref_path.exists() else None

    candidates: list[Path] = [base_dir / ref]
    ext = ref_path.suffix.lower()
    if ext in {".stl", ".obj", ".dae", ".msh"} and "meshdir" in compiler_dirs:
        mesh_root = base_dir / compiler_dirs["meshdir"]
        candidates.insert(0, mesh_root / ref)
        candidates.insert(1, mesh_root / ref_path.name)
    if ext in {".png", ".jpg", ".jpeg", ".ktx"} and "texturedir" in compiler_dirs:
        tex_root = base_dir / compiler_dirs["texturedir"]
        candidates.insert(0, tex_root / ref)
        candidates.insert(1, tex_root / ref_path.name)

    for c in candidates:
        resolved = c.resolve()
        if resolved.exists():
            return resolved
    return None


def collect_referenced_files(xml_path: Path, seen_xml: set[Path] | None = None) -> set[Path]:
    if seen_xml is None:
        seen_xml = set()
    xml_path = xml_path.resolve()
    if xml_path in seen_xml:
        return set()
    seen_xml.add(xml_path)

    text = xml_path.read_text(errors="replace")
    compiler_dirs = parse_compiler_dirs(text)
    base_dir = xml_path.parent
    found: set[Path] = {xml_path}

    for m in INCLUDE_RE.finditer(text):
        inc = (base_dir / m.group(1)).resolve()
        if inc.exists():
            found |= collect_referenced_files(inc, seen_xml)

    for m in FILE_ATTR_RE.finditer(text):
        ref = m.group(1)
        if ref.startswith(("http://", "https://")):
            continue
        resolved = resolve_asset(base_dir, ref, compiler_dirs)
        if resolved is None:
            continue
        if resolved.suffix.lower() == ".xml":
            found |= collect_referenced_files(resolved, seen_xml)
        else:
            found.add(resolved)

    return found


def sync_robot(gmr: Path, robot_id: str, meta: dict) -> tuple[dict, str | None]:
    src_xml = gmr / meta["xml"]
    if not src_xml.exists():
        raise FileNotFoundError(f"Missing GMR asset: {src_xml}")

    parts = Path(meta["xml"]).parts
    asset_root = gmr / parts[0] / parts[1]
    dest = ROBOTS_DIR / robot_id
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)

    referenced = collect_referenced_files(src_xml)
    rel_files: list[str] = []
    for src in sorted(referenced):
        rel = src.relative_to(asset_root).as_posix()
        dst = dest / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        rel_files.append(rel)

    entry = {
        "id": robot_id,
        "label": meta["label"],
        "xml": src_xml.relative_to(asset_root).as_posix(),
        "baseBody": meta["baseBody"],
        "camDistance": meta["camDistance"],
        "configKey": "bvh_lafan1" if "bvh_config" in meta else "smplx",
        "files": sorted(set(rel_files)),
    }
    config_name = meta.get("bvh_config") or meta.get("smplx_config")
    return entry, config_name


def sync_configs(gmr: Path, config_names: set[str]) -> None:
    src_root = gmr / "general_motion_retargeting" / "ik_configs"
    CONFIGS_DIR.mkdir(parents=True, exist_ok=True)
    rename = {
        "bvh_lafan1_to_g1.json": "bvh_lafan1_to_unitree_g1.json",
        "bvh_lafan1_to_t1_29dof.json": "bvh_lafan1_to_booster_t1_29dof.json",
    }
    for name in sorted(config_names):
        src = src_root / name
        if not src.exists():
            raise FileNotFoundError(f"Missing ik_config: {src}")
        shutil.copy2(src, CONFIGS_DIR / rename.get(name, name))


def write_defaults(robot_config_map: dict[str, str]) -> None:
    imports: list[str] = []
    entries: list[str] = []
    cfg_vars: dict[str, str] = {}
    for robot_id, cfg_file in sorted(robot_config_map.items()):
        if cfg_file not in cfg_vars:
            var = re.sub(r"[^a-zA-Z0-9]", "_", cfg_file.replace(".json", ""))
            cfg_vars[cfg_file] = var
            imports.append(f"import {var} from './configs/{cfg_file}';")
        entries.append(f"  {robot_id}: {cfg_vars[cfg_file]} as unknown as GmrIkConfig,")

    content = f"""/**
 * Built-in robots and their default GMR ik_configs (copied verbatim from the
 * GMR repository, MIT License — https://github.com/YanjieZe/GMR).
 *
 * Regenerate via: python3 scripts/prepare_gmr_robots.py
 */

{chr(10).join(imports)}
import type {{ GmrIkConfig }} from './types';

export const DEFAULT_CONFIGS: Record<string, GmrIkConfig> = {{
{chr(10).join(entries)}
}};

export function getDefaultConfig(robotId: string): GmrIkConfig {{
  const cfg = DEFAULT_CONFIGS[robotId];
  if (!cfg) throw new Error(`No default config for robot ${{robotId}}`);
  return structuredClone(cfg);
}}

export function validateConfig(raw: unknown): GmrIkConfig {{
  if (typeof raw !== 'object' || raw === null) throw new Error('Config must be a JSON object');
  const cfg = raw as Partial<GmrIkConfig>;
  const required: (keyof GmrIkConfig)[] = [
    'robot_root_name',
    'human_root_name',
    'human_height_assumption',
    'human_scale_table',
    'ik_match_table1',
    'ik_match_table2',
  ];
  for (const key of required) {{
    if (cfg[key] === undefined) throw new Error(`Config missing field "${{key}}"`);
  }}
  return {{
    ground_height: 0,
    use_ik_match_table1: true,
    use_ik_match_table2: true,
    ...cfg,
  }} as GmrIkConfig;
}}
"""
    DEFAULTS_TS.write_text(content)


def ensure_gmr(path: Path) -> Path:
    if path.exists():
        return path
    print(f"Cloning GMR into {path} …", file=sys.stderr)
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["git", "clone", "--depth", "1", "https://github.com/YanjieZe/GMR.git", str(path)],
        check=True,
    )
    return path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gmr", type=Path, default=Path("/tmp/gmr"))
    args = ap.parse_args()
    gmr = ensure_gmr(args.gmr)

    manifest: list[dict] = []
    config_names: set[str] = set()
    robot_config_map: dict[str, str] = {}
    rename = {
        "bvh_lafan1_to_g1.json": "bvh_lafan1_to_unitree_g1.json",
        "bvh_lafan1_to_t1_29dof.json": "bvh_lafan1_to_booster_t1_29dof.json",
    }

    for robot_id, meta in ROBOTS.items():
        print(f"sync {robot_id} …", file=sys.stderr)
        entry, cfg_name = sync_robot(gmr, robot_id, meta)
        manifest.append(entry)
        if cfg_name:
            config_names.add(cfg_name)
            robot_config_map[robot_id] = rename.get(cfg_name, cfg_name)

    sync_configs(gmr, config_names)
    (ROBOTS_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    write_defaults(robot_config_map)
    write_robot_tests(list(ROBOTS.keys()))
    print(f"Synced {len(manifest)} robots.", file=sys.stderr)


def write_robot_tests(robot_ids: list[str]) -> None:
    tests_dir = ROOT / "tests" / "robots"
    tests_dir.mkdir(parents=True, exist_ok=True)
    for old in tests_dir.glob("*.test.ts"):
        if old.name != "_utils.ts":
            old.unlink()
    for robot_id in robot_ids:
        (tests_dir / f"{robot_id}.test.ts").write_text(
            f"""import {{ describe, it }} from 'vitest';
import {{ entryById, smokeLoad }} from './_utils';

describe('{robot_id}', () => {{
  it('loads and ik_config matches model', async () => {{
    await smokeLoad(entryById('{robot_id}'));
  }});
}});
"""
        )


if __name__ == "__main__":
    main()
