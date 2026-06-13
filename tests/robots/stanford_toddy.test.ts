import { describe, it } from 'vitest';
import { entryById, smokeLoad } from './_utils';

describe('stanford_toddy', () => {
  it('loads and ik_config matches model', async () => {
    await smokeLoad(entryById('stanford_toddy'));
  });
});
