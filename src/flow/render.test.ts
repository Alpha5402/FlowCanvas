import { describe, expect, it } from 'vitest';
import {
  getConnectionStrokeWidth,
  getConnectionTextBackground,
  getElementStrokeWidth,
  getElementTextMaxWidth,
  getRenderPixelRatio,
  shouldFillElement,
  shouldRenderConnection,
  shouldDrawConnectionTextGap,
} from './render';

describe('render', () => {
  it('allows zero-width normal borders while keeping hover and focus outlines visible', () => {
    const element = { borderWidth: 0 };

    expect(getElementStrokeWidth(element, false, false)).toBe(0);
    expect(getElementStrokeWidth(element, false, true)).toBe(1.5);
    expect(getElementStrokeWidth(element, true, false)).toBe(2);
  });

  it('skips element fills only for transparent fill state', () => {
    expect(shouldFillElement('transparent')).toBe(false);
    expect(shouldFillElement(' TRANSPARENT ')).toBe(false);
    expect(shouldFillElement('#ffffff')).toBe(true);
  });

  it('does not constrain fit-content text width so canvas will not squeeze glyphs', () => {
    expect(getElementTextMaxWidth({ sizeMode: 'fit-content', padding: 12 }, 120)).toBeUndefined();
    expect(getElementTextMaxWidth({ sizeMode: 'fixed', padding: 12 }, 120)).toBe(96);
    expect(getElementTextMaxWidth({ sizeMode: 'fixed', padding: 20 }, 30)).toBe(12);
  });

  it('uses explicit render pixel ratios for high-resolution exports', () => {
    expect(getRenderPixelRatio({ pixelRatio: 3 })).toBe(3);
    expect(getRenderPixelRatio({ pixelRatio: 0.5 })).toBe(1);
  });

  it('hides the original connection while a reconnect preview is active', () => {
    expect(shouldRenderConnection({ id: 'connection-a' }, null)).toBe(true);
    expect(shouldRenderConnection({ id: 'connection-a' }, { hiddenConnectionId: 'connection-b' })).toBe(true);
    expect(shouldRenderConnection({ id: 'connection-a' }, { hiddenConnectionId: 'connection-a' })).toBe(false);
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

  it('only cuts a line gap for middle connection text', () => {
    expect(shouldDrawConnectionTextGap('middle')).toBe(true);
    expect(shouldDrawConnectionTextGap('above')).toBe(false);
    expect(shouldDrawConnectionTextGap('below')).toBe(false);
  });
});
