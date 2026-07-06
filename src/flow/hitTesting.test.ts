import { describe, expect, it } from 'vitest';
import type { Connection, FlowElement } from '../types/flow';
import { getConnectionLabelBox, getConnectionPath } from './geometry';
import {
  getConnectionHitDistance,
  hitTestCanvasObject,
  hitTestConnection,
  hitTestElementAnchorOrEdge,
  inferConnectionDragEnd,
} from './hitTesting';

const element: FlowElement = {
  id: 'a',
  x: 0,
  y: 0,
  width: 120,
  height: 60,
  sizeMode: 'fixed',
  shape: 'rect',
  text: '',
  padding: 10,
  textAlign: 'center',
  borderRadius: 0,
  backgroundColor: 'transparent',
  borderColor: '#000000',
  borderWidth: 1,
};

const connection: Connection = {
  id: 'c',
  source: { elementId: 'a', side: 'right' },
  target: { elementId: 'b', side: 'left' },
  lineType: 'solid',
  lineWidth: 1,
  dashLength: 8,
  dashGap: 6,
  arrow: 'end',
  text: 'Label',
  textPosition: 'above',
};

const measurer = {
  measureText: (text: string) => ({ width: text.length * 8 }),
};

describe('hitTesting', () => {
  it('expands connection hit distance for thick lines while preserving the default target size', () => {
    expect(getConnectionHitDistance({ lineWidth: 1 })).toBe(8);
    expect(getConnectionHitDistance({ lineWidth: 12 })).toBe(13.5);
  });

  it('selects connections from their visible text label box', () => {
    const elements = [element, { ...element, id: 'b', x: 260, y: 160 }];
    const path = getConnectionPath(connection, elements, measurer)!;
    const labelBox = getConnectionLabelBox(connection, path, measurer)!;

    expect(
      hitTestConnection(
        { x: labelBox.x + labelBox.width / 2, y: labelBox.y + labelBox.height / 2 },
        [connection],
        elements,
        measurer,
      )?.id,
    ).toBe('c');
  });

  it('infers which connection end should move from the drag start position', () => {
    const elements = [element, { ...element, id: 'b', x: 260, y: 160 }];

    expect(inferConnectionDragEnd({ x: 140, y: 50 }, connection, elements, measurer)).toBe('source');
    expect(inferConnectionDragEnd({ x: 250, y: 170 }, connection, elements, measurer)).toBe('target');
  });

  it('prioritizes elements over connections to match the render stack', () => {
    const elements = [
      element,
      { ...element, id: 'b', x: 260, y: 0 },
      { ...element, id: 'overlay', x: 145, y: 20, width: 90, height: 50 },
    ];
    const hit = hitTestCanvasObject({ x: 190, y: 45 }, elements, [{ ...connection, text: '' }], measurer);

    expect(hit).toEqual({ type: 'element', item: expect.objectContaining({ id: 'overlay' }) });
  });

  it('resolves connection targets from element anchors and nearby edges without selecting first', () => {
    const elements = [
      element,
      { ...element, id: 'b', x: 260, y: 120 },
    ];

    expect(hitTestElementAnchorOrEdge({ x: 260, y: 150 }, elements, 'a', measurer)).toEqual(
      expect.objectContaining({ elementId: 'b', side: 'left' }),
    );
    expect(hitTestElementAnchorOrEdge({ x: 320, y: 119 }, elements, 'a', measurer)).toEqual(
      expect.objectContaining({ elementId: 'b', side: 'top' }),
    );
  });

  it('does not resolve a connection target on the source element', () => {
    expect(hitTestElementAnchorOrEdge({ x: 120, y: 30 }, [element], 'a', measurer)).toBeNull();
  });
});
