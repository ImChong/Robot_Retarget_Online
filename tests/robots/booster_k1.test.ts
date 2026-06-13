import { describe, it } from 'vitest';
import { entryById, smokeLoad } from './_utils';

describe('booster_k1', () => {
  it('loads and ik_config matches model', async () => {
    await smokeLoad(entryById('booster_k1'));
  });
});
