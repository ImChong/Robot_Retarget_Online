import { describe, it } from 'vitest';
import { entryById, smokeLoad } from './_utils';

describe('unitree_g1', () => {
  it('loads and ik_config matches model', async () => {
    await smokeLoad(entryById('unitree_g1'));
  });
});
