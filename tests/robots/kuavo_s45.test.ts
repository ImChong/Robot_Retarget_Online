import { describe, it } from 'vitest';
import { entryById, smokeLoad } from './_utils';

describe('kuavo_s45', () => {
  it('loads and ik_config matches model', async () => {
    await smokeLoad(entryById('kuavo_s45'));
  });
});
