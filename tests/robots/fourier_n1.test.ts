import { describe, it } from 'vitest';
import { entryById, smokeLoad } from './_utils';

describe('fourier_n1', () => {
  it('loads and ik_config matches model', async () => {
    await smokeLoad(entryById('fourier_n1'));
  });
});
