import { describe, it } from 'vitest';
import { parityRefPath, runParitySuite, refAvailable } from './_utils';

describe.skipIf(!refAvailable('unitree_g1'))('parity unitree_g1', () => {
  it('matches Python GMR on walk.bvh', async () => {
    await runParitySuite('unitree_g1', parityRefPath('unitree_g1'));
  });
});
