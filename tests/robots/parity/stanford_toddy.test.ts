import { describe, it } from 'vitest';
import { parityRefPath, runParitySuite, refAvailable } from './_utils';

describe.skipIf(!refAvailable('stanford_toddy'))('parity stanford_toddy', () => {
  it('matches Python GMR on walk.bvh', async () => {
    await runParitySuite('stanford_toddy', parityRefPath('stanford_toddy'));
  });
});
