import { describe, expect, it } from 'vitest';
import type { Connection, FlowElement } from '../types/flow';
import {
  applyElementSizeMode,
  clearHoverState,
  cloneSnapshot,
  createFixedResizeBase,
  deleteSelectionFromFlow,
  getExportContent,
  getConnectionEndpoint,
  getSharedValue,
  hasElementGeometryChanged,
  hasElementPositionChanges,
  hasFlowContentChanged,
  hasSignificantPanMovement,
  isEditingFieldTag,
  isSelected,
  normalizeHexColorInput,
  normalizeConnectionNumber,
  normalizeElementNumber,
  resolvePreviewTarget,
  restoreElementPositions,
  shouldHideElementControls,
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
  it('detects form editing targets for keyboard shortcut scoping', () => {
    expect(isEditingFieldTag('INPUT')).toBe(true);
    expect(isEditingFieldTag('SELECT')).toBe(true);
    expect(isEditingFieldTag('TEXTAREA')).toBe(true);
    expect(isEditingFieldTag('BUTTON')).toBe(false);
    expect(isEditingFieldTag(undefined)).toBe(false);
  });

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

  it('normalizes legacy connection endpoints when cloning snapshots', () => {
    const legacy = {
      ...connection,
      source: undefined,
      target: undefined,
      sourceElementId: 'legacy-a',
      targetElementId: 'legacy-b',
    } as unknown as Connection;
    const cloned = cloneSnapshot({ elements: [], connections: [legacy], selection: null });

    expect(cloned.connections[0].source).toEqual({ elementId: 'legacy-a', side: 'right' });
    expect(cloned.connections[0].target).toEqual({ elementId: 'legacy-b', side: 'left' });
    expect(getConnectionEndpoint(legacy, 'source')).toEqual({ elementId: 'legacy-a', side: 'right' });
  });

  it('returns shared batch values only when every selected item matches', () => {
    const same = [
      { ...element, id: 'a', borderWidth: 2 },
      { ...element, id: 'b', borderWidth: 2 },
    ];
    const mixed = [
      { ...element, id: 'a', borderWidth: 2 },
      { ...element, id: 'b', borderWidth: 4 },
    ];

    expect(getSharedValue(same, 'borderWidth')).toBe(2);
    expect(getSharedValue(mixed, 'borderWidth')).toBe('');
    expect(getSharedValue([], 'borderWidth')).toBe('');
  });

  it('hides element controls for any multi-selection, including mixed selections', () => {
    expect(shouldHideElementControls(null)).toBe(false);
    expect(shouldHideElementControls({ type: 'element', id: 'element-a' })).toBe(false);
    expect(
      shouldHideElementControls({
        type: 'multi',
        items: [
          { type: 'element', id: 'element-a' },
          { type: 'connection', id: 'connection-a' },
        ],
      }),
    ).toBe(true);
  });

  it('keeps the preview target when pointerup lands just outside the target hit area', () => {
    const previewTarget = { elementId: 'element-b', side: 'left' as const, x: 120, y: 40, normalVector: { x: -1, y: 0 } };
    const currentTarget = { elementId: 'element-c', side: 'top' as const, x: 200, y: 20, normalVector: { x: 0, y: -1 } };

    expect(resolvePreviewTarget(null, previewTarget)).toBe(previewTarget);
    expect(resolvePreviewTarget(currentTarget, previewTarget)).toBe(currentTarget);
  });

  it('resolves export content for board and selection exports', () => {
    const elements = [
      { ...element, id: 'a' },
      { ...element, id: 'b' },
      { ...element, id: 'c' },
    ];
    const connections: Connection[] = [
      { ...connection, id: 'ab', source: { elementId: 'a', side: 'right' }, target: { elementId: 'b', side: 'left' } },
      { ...connection, id: 'bc', source: { elementId: 'b', side: 'right' }, target: { elementId: 'c', side: 'left' } },
    ];

    expect(getExportContent(elements, connections, null)).toEqual({ elements, connections });
    expect(getExportContent(elements, connections, { type: 'connection', id: 'ab' }).elements.map((item) => item.id)).toEqual([
      'a',
      'b',
    ]);
    expect(getExportContent(elements, connections, { type: 'element', id: 'a' }).connections).toHaveLength(0);
    expect(
      getExportContent(elements, connections, {
        type: 'multi',
        items: [
          { type: 'element', id: 'a' },
          { type: 'element', id: 'b' },
        ],
      }).connections.map((item) => item.id),
    ).toEqual(['ab']);
    expect(
      getExportContent(elements, connections, {
        type: 'multi',
        items: [
          { type: 'element', id: 'a' },
          { type: 'connection', id: 'bc' },
        ],
      }).elements.map((item) => item.id),
    ).toEqual(['a', 'b', 'c']);
    expect(
      getExportContent(elements, connections, {
        type: 'multi',
        items: [
          { type: 'element', id: 'a' },
          { type: 'connection', id: 'bc' },
        ],
      }).connections.map((item) => item.id),
    ).toEqual(['bc']);
    expect(getExportContent(elements, connections, { type: 'element', id: 'missing' })).toEqual({ elements, connections });
    expect(
      getExportContent(elements, connections, {
        type: 'multi',
        items: [
          { type: 'element', id: 'missing' },
          { type: 'connection', id: 'ab' },
        ],
      }).elements.map((item) => item.id),
    ).toEqual(['a', 'b']);
  });

  it('resolves legacy connection endpoints for deletion and export content', () => {
    const elements = [
      { ...element, id: 'legacy-a' },
      { ...element, id: 'legacy-b' },
    ];
    const legacy = {
      ...connection,
      id: 'legacy',
      source: undefined,
      target: undefined,
      sourceElementId: 'legacy-a',
      targetElementId: 'legacy-b',
    } as unknown as Connection;

    expect(getExportContent(elements, [legacy], { type: 'connection', id: 'legacy' }).elements.map((item) => item.id)).toEqual([
      'legacy-a',
      'legacy-b',
    ]);
    expect(deleteSelectionFromFlow(elements, [legacy], { type: 'element', id: 'legacy-a' }).connections).toHaveLength(0);
  });

  it('detects whether flow content ids changed after an operation', () => {
    const previous = {
      elements: [{ ...element, id: 'a' }, { ...element, id: 'b' }],
      connections: [{ ...connection, id: 'ab' }],
    };

    expect(hasFlowContentChanged(previous, { elements: previous.elements, connections: previous.connections })).toBe(false);
    expect(hasFlowContentChanged(previous, { elements: [previous.elements[0]], connections: previous.connections })).toBe(true);
    expect(
      hasFlowContentChanged(previous, {
        elements: [previous.elements[1], previous.elements[0]],
        connections: previous.connections,
      }),
    ).toBe(true);
  });

  it('normalizes numeric element values before writing inspector changes', () => {
    expect(normalizeElementNumber('width', 12)).toBe(48);
    expect(normalizeElementNumber('height', 12)).toBe(32);
    expect(normalizeElementNumber('padding', -4)).toBe(0);
    expect(normalizeElementNumber('borderRadius', -2)).toBe(0);
    expect(normalizeElementNumber('borderWidth', -1)).toBe(0);
    expect(normalizeElementNumber('borderWidth', 20)).toBe(12);
  });

  it('normalizes numeric connection values before writing inspector changes', () => {
    expect(normalizeConnectionNumber('lineWidth', 0)).toBe(1);
    expect(normalizeConnectionNumber('lineWidth', 20)).toBe(12);
    expect(normalizeConnectionNumber('dashLength', 0)).toBe(1);
    expect(normalizeConnectionNumber('dashGap', -6)).toBe(1);
  });

  it('normalizes pasted hex color input before batch style changes', () => {
    expect(normalizeHexColorInput('  #aBc123  ')).toBe('#aBc123');
    expect(normalizeHexColorInput('aBc123')).toBe('#aBc123');
    expect(normalizeHexColorInput('#123')).toBe('#112233');
    expect(normalizeHexColorInput('fff')).toBe('#ffffff');
    expect(normalizeHexColorInput('#12')).toBeNull();
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

  it('detects whether dragged elements actually ended at changed positions', () => {
    const elements = [
      { ...element, id: 'a', x: 0, y: 10 },
      { ...element, id: 'b', x: 20, y: 30 },
    ];
    const originals = [
      { id: 'a', x: 0, y: 10 },
      { id: 'b', x: 20, y: 30 },
    ];

    expect(hasElementPositionChanges(elements, originals)).toBe(false);

    elements[1].y = 31;

    expect(hasElementPositionChanges(elements, originals)).toBe(true);
  });

  it('detects whether a resized element actually ended with changed geometry', () => {
    expect(hasElementGeometryChanged(element, { ...element })).toBe(false);
    expect(hasElementGeometryChanged({ ...element, width: element.width + 1 }, element)).toBe(true);
    expect(hasElementGeometryChanged({ ...element, sizeMode: 'fit-content' }, element)).toBe(true);
  });

  it('detects significant pan movement only after the click tolerance', () => {
    const start = { x: 10, y: 10 };

    expect(hasSignificantPanMovement(start, { x: 13, y: 10 })).toBe(false);
    expect(hasSignificantPanMovement(start, { x: 14, y: 10 })).toBe(true);
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
