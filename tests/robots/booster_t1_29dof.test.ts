import { describe, it } from 'vitest';
import { entryById, smokeLoad } from './_utils';

describe('booster_t1_29dof', () => {
  it('loads and ik_config matches model', async () => {
    await smokeLoad(entryById('booster_t1_29dof'));
  });
});
