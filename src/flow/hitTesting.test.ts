import { describe, expect, it } from 'vitest';
import { getConnectionHitDistance } from './hitTesting';

describe('hitTesting', () => {
  it('expands connection hit distance for thick lines while preserving the default target size', () => {
    expect(getConnectionHitDistance({ lineWidth: 1 })).toBe(8);
    expect(getConnectionHitDistance({ lineWidth: 12 })).toBe(13.5);
  });
});
