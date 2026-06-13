import { describe, it } from 'vitest';
import { entryById, smokeLoad } from './_utils';

describe('engineai_pm01', () => {
  it('loads and ik_config matches model', async () => {
    await smokeLoad(entryById('engineai_pm01'));
  });
});
