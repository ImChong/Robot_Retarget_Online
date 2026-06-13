import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './_utils';

/** Robots kept on disk for reference but not in the UI dropdown (no BVH ik_config). */
const ASSET_ONLY_IDS = [
  "unitree_h1",
  "unitree_h1_2",
  "booster_t1",
  "kuavo_s45",
  "hightorque_hi",
  "galaxea_r1pro",
  "berkeley_humanoid_lite",
  "booster_k1",
  "pnd_adam_lite",
  "tienkung",
  "fourier_gr3"
] as const;
const XML_BY_ID: Record<string, string> = {
  "unitree_h1": "h1.xml",
  "unitree_h1_2": "h1_2_handless.xml",
  "booster_t1": "T1_serial.xml",
  "kuavo_s45": "biped_s45_collision.xml",
  "hightorque_hi": "hi_25dof.xml",
  "galaxea_r1pro": "r1_pro.xml",
  "berkeley_humanoid_lite": "bhl_scene.xml",
  "booster_k1": "K1_serial.xml",
  "pnd_adam_lite": "scene.xml",
  "tienkung": "mjcf/tienkung.xml",
  "fourier_gr3": "mjcf/gr3v2_1_1_dummy_hand.xml"
};

describe('asset-only robots (not in dropdown)', () => {
  for (const id of ASSET_ONLY_IDS) {
    it(`${id}: MJCF and meshes present`, () => {
      const dir = join(ROOT, 'public', 'robots', id);
      expect(existsSync(dir)).toBe(true);
      const xml = join(dir, XML_BY_ID[id]);
      expect(existsSync(xml)).toBe(true);
      expect(readFileSync(xml, 'utf-8').length).toBeGreaterThan(100);
    });
  }
});
