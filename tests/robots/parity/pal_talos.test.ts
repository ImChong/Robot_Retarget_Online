import { describe, it } from 'vitest';
import { parityRefPath, runParitySuite, refAvailable } from './_utils';

describe.skipIf(!refAvailable('pal_talos'))('parity pal_talos', () => {
  it('matches Python GMR on walk.bvh', async () => {
    await runParitySuite('pal_talos', parityRefPath('pal_talos'));
  });
});
