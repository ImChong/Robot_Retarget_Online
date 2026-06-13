import { describe, it } from 'vitest';
import { entryById, smokeLoad } from './_utils';

describe('unitree_h1', () => {
  it('loads and ik_config matches model', async () => {
    await smokeLoad(entryById('unitree_h1'));
  });
});
