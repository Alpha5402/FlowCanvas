import { describe, expect, it } from 'vitest';
import { getElementStrokeWidth } from './render';

describe('render', () => {
  it('allows zero-width normal borders while keeping hover and focus outlines visible', () => {
    const element = { borderWidth: 0 };

    expect(getElementStrokeWidth(element, false, false)).toBe(0);
    expect(getElementStrokeWidth(element, false, true)).toBe(1.5);
    expect(getElementStrokeWidth(element, true, false)).toBe(2);
  });
});
