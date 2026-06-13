import { describe, it } from 'vitest';
import { entryById, smokeLoad } from './_utils';

describe('pal_talos', () => {
  it('loads and ik_config matches model', async () => {
    await smokeLoad(entryById('pal_talos'));
  });
});
