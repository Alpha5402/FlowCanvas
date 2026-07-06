import { describe, expect, it } from 'vitest';
import type { Connection, FlowElement } from '../types/flow';
import {
  applyElementSizeMode,
  clearHoverState,
  cloneSnapshot,
  createFixedResizeBase,
  isSelected,
  restoreElementPositions,
  toggleSelection,
} from './state';

const element: FlowElement = {
  id: 'element-a',
  x: 0,
  y: 0,
  width: 120,
  height: 64,
  sizeMode: 'fixed',
  shape: 'rect',
  text: 'Node',
  padding: 12,
  textAlign: 'center',
  borderRadius: 0,
  backgroundColor: '#ffffff',
  borderColor: '#111111',
  borderWidth: 1,
};

const connection: Connection = {
  id: 'connection-a',
  source: { elementId: 'element-a', side: 'right' },
  target: { elementId: 'element-b', side: 'left' },
  lineType: 'solid',
  lineWidth: 1,
  dashLength: 10,
  dashGap: 8,
  arrow: 'end',
  text: '',
  textPosition: 'middle',
};

describe('state', () => {
  it('toggles multi-selection back to a single item and then empty', () => {
    const multi = toggleSelection({ type: 'element', id: 'element-a' }, { type: 'connection', id: 'connection-a' });
    const single = toggleSelection(multi, { type: 'element', id: 'element-a' });
    const empty = toggleSelection(single, { type: 'connection', id: 'connection-a' });

    expect(multi?.type).toBe('multi');
    expect(isSelected(single, 'connection', 'connection-a')).toBe(true);
    expect(single).toEqual({ type: 'connection', id: 'connection-a' });
    expect(empty).toBeNull();
  });

  it('deep-clones connection endpoints and multi-selection items in snapshots', () => {
    const snapshot = {
      elements: [element],
      connections: [connection],
      selection: {
        type: 'multi' as const,
        items: [
          { type: 'element' as const, id: 'element-a' },
          { type: 'connection' as const, id: 'connection-a' },
        ],
      },
    };
    const cloned = cloneSnapshot(snapshot);

    cloned.connections[0].source.elementId = 'changed';
    if (cloned.selection?.type === 'multi') {
      cloned.selection.items[0].id = 'changed';
    }

    expect(snapshot.connections[0].source.elementId).toBe('element-a');
    expect(snapshot.selection.items[0].id).toBe('element-a');
  });

  it('preserves measured dimensions when switching fit-content elements to fixed', () => {
    const next = { ...element, sizeMode: 'fit-content' as const, width: 20, height: 20 };
    const changed = applyElementSizeMode(next, 'fixed', { width: 148, height: 52 });

    expect(changed).toBe(true);
    expect(next.sizeMode).toBe('fixed');
    expect(next.width).toBe(148);
    expect(next.height).toBe(52);
  });

  it('does not report a size mode change when the element already matches', () => {
    const next = { ...element };

    expect(applyElementSizeMode(next, 'fixed', { width: 200, height: 80 })).toBe(false);
    expect(next.width).toBe(120);
    expect(next.height).toBe(64);
  });

  it('creates a fixed resize baseline without mutating fit-content elements', () => {
    const original = { ...element, sizeMode: 'fit-content' as const, width: 20, height: 20 };
    const base = createFixedResizeBase(original, { width: 148, height: 52 });

    expect(base).toEqual(expect.objectContaining({ sizeMode: 'fixed', width: 148, height: 52 }));
    expect(original).toEqual(expect.objectContaining({ sizeMode: 'fit-content', width: 20, height: 20 }));
  });

  it('restores dragged element positions without touching unrelated elements', () => {
    const elements = [
      { ...element, id: 'a', x: 100, y: 110 },
      { ...element, id: 'b', x: 200, y: 210 },
      { ...element, id: 'c', x: 300, y: 310 },
    ];

    restoreElementPositions(elements, [
      { id: 'a', x: 0, y: 10 },
      { id: 'b', x: 20, y: 30 },
    ]);

    expect(elements.map(({ id, x, y }) => ({ id, x, y }))).toEqual([
      { id: 'a', x: 0, y: 10 },
      { id: 'b', x: 20, y: 30 },
      { id: 'c', x: 300, y: 310 },
    ]);
  });

  it('clears every hover state after an interaction finishes', () => {
    const hoverState = {
      hoverElementId: 'element-a',
      hoverConnectionId: 'connection-a',
      hoverAnchor: { elementId: 'element-a', side: 'right' as const },
      hoverResizeHandle: 'bottom-right' as const,
    };

    clearHoverState(hoverState);

    expect(hoverState).toEqual({
      hoverElementId: null,
      hoverConnectionId: null,
      hoverAnchor: null,
      hoverResizeHandle: null,
    });
  });
});
