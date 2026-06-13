import { describe, it } from 'vitest';
import { entryById, smokeLoad } from './_utils';

describe('galaxea_r1pro', () => {
  it('loads and ik_config matches model', async () => {
    await smokeLoad(entryById('galaxea_r1pro'));
  });
});
