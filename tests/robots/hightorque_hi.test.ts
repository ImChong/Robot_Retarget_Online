import { describe, it } from 'vitest';
import { entryById, smokeLoad } from './_utils';

describe('hightorque_hi', () => {
  it('loads and ik_config matches model', async () => {
    await smokeLoad(entryById('hightorque_hi'));
  });
});
