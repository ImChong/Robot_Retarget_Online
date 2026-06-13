import { describe, it } from 'vitest';
import { entryById, smokeLoad } from './_utils';

describe('pnd_adam_lite', () => {
  it('loads and ik_config matches model', async () => {
    await smokeLoad(entryById('pnd_adam_lite'));
  });
});
