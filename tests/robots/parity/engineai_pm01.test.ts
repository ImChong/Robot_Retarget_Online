import { describe, it } from 'vitest';
import { parityRefPath, runParitySuite, refAvailable } from './_utils';

describe.skipIf(!refAvailable('engineai_pm01'))('parity engineai_pm01', () => {
  it('matches Python GMR on walk.bvh', async () => {
    await runParitySuite('engineai_pm01', parityRefPath('engineai_pm01'));
  });
});
