import { describe, it } from 'vitest';
import { entryById, smokeLoad } from './_utils';

describe('berkeley_humanoid_lite', () => {
  it('loads and ik_config matches model', async () => {
    await smokeLoad(entryById('berkeley_humanoid_lite'));
  });
});
