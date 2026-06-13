import { describe, it } from 'vitest';
import { parityRefPath, runParitySuite, refAvailable } from './_utils';

describe.skipIf(!refAvailable('booster_t1_29dof'))('parity booster_t1_29dof', () => {
  it('matches Python GMR on walk.bvh', async () => {
    await runParitySuite('booster_t1_29dof', parityRefPath('booster_t1_29dof'));
  });
});
