import { describe, it } from 'vitest';
import { parityRefPath, runParitySuite, refAvailable } from './_utils';

describe.skipIf(!refAvailable('unitree_g1_with_hands'))('parity unitree_g1_with_hands', () => {
  it('matches Python GMR on walk.bvh', async () => {
    await runParitySuite('unitree_g1_with_hands', parityRefPath('unitree_g1_with_hands'));
  });
});
