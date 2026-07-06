import { describe, expect, it } from 'vitest';
import { getConnectionStrokeWidth, getConnectionTextBackground, getElementStrokeWidth } from './render';

describe('render', () => {
  it('allows zero-width normal borders while keeping hover and focus outlines visible', () => {
    const element = { borderWidth: 0 };

    expect(getElementStrokeWidth(element, false, false)).toBe(0);
    expect(getElementStrokeWidth(element, false, true)).toBe(1.5);
    expect(getElementStrokeWidth(element, true, false)).toBe(2);
  });

  it('keeps connection hover and focus strokes visibly emphasized', () => {
    const connection = { lineWidth: 2 };

    expect(getConnectionStrokeWidth(connection, false, false)).toBe(2);
    expect(getConnectionStrokeWidth(connection, false, true)).toBe(3.5);
    expect(getConnectionStrokeWidth(connection, true, false)).toBe(3.5);
    expect(getConnectionStrokeWidth({ lineWidth: 0 }, false, false)).toBe(1);
  });

  it('matches connection text background to canvas export mode', () => {
    expect(getConnectionTextBackground(true)).toBe('#f5f7fb');
    expect(getConnectionTextBackground(false)).toBe('#ffffff');
  });
});
