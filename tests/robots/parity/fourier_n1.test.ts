import { describe, it } from 'vitest';
import { parityRefPath, runParitySuite, refAvailable } from './_utils';

describe.skipIf(!refAvailable('fourier_n1'))('parity fourier_n1', () => {
  it('matches Python GMR on walk.bvh', async () => {
    await runParitySuite('fourier_n1', parityRefPath('fourier_n1'));
  });
});
