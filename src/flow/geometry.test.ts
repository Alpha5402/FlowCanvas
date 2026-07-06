import { describe, expect, it } from 'vitest';
import type { Connection, FlowElement } from '../types/flow';
import {
  createConnectionPath,
  distanceToConnection,
  getArrowAngle,
  getConnectionPath,
  getElementAnchors,
  hasSignificantPointerMovement,
  inferTargetSide,
  measureFitContent,
  pointInElement,
  resizeElementBox,
  snapElement,
  snapPreviewPoint,
} from './geometry';
import { deleteSelectionFromFlow, pushHistory, redo, toggleSelection, undo, type HistoryState } from './state';

const baseElement: FlowElement = {
  id: 'a',
  x: 10,
  y: 20,
  width: 120,
  height: 60,
  sizeMode: 'fixed',
  shape: 'rounded-rect',
  text: 'Node',
  padding: 10,
  textAlign: 'center',
  borderRadius: 8,
  backgroundColor: '#ffffff',
  borderColor: '#000000',
  borderWidth: 2,
};

const measurer = {
  measureText: (text: string) => ({ width: text.length * 8 }),
};

function connection(): Connection {
  return {
    id: 'c',
    source: { elementId: 'a', side: 'right' },
    target: { elementId: 'b', side: 'left' },
    lineType: 'solid',
    lineWidth: 1,
    dashLength: 8,
    dashGap: 6,
    arrow: 'end',
    text: '',
    textPosition: 'middle',
  };
}

describe('geometry', () => {
  it('measures fit-content elements from text, padding, and border', () => {
    const size = measureFitContent(
      {
        ...baseElement,
        sizeMode: 'fit-content',
        text: 'Long text',
        padding: 12,
        borderWidth: 3,
      },
      measurer,
    );

    expect(size.width).toBe(102);
    expect(size.height).toBe(50);
  });

  it('calculates four dynamic anchors with normal vectors', () => {
    const anchors = getElementAnchors(baseElement, measurer);

    expect(anchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ side: 'top', x: 70, y: 20, normalVector: { x: 0, y: -1 } }),
        expect.objectContaining({ side: 'right', x: 130, y: 50, normalVector: { x: 1, y: 0 } }),
        expect.objectContaining({ side: 'bottom', x: 70, y: 80, normalVector: { x: 0, y: 1 } }),
        expect.objectContaining({ side: 'left', x: 10, y: 50, normalVector: { x: -1, y: 0 } }),
      ]),
    );
  });

  it('hit-tests ellipse and circle elements by their visible shape', () => {
    const ellipse: FlowElement = { ...baseElement, shape: 'ellipse', x: 0, y: 0, width: 120, height: 60 };
    const circle: FlowElement = { ...baseElement, shape: 'circle', x: 0, y: 0, width: 140, height: 80 };

    expect(pointInElement({ x: 60, y: 30 }, ellipse, measurer)).toBe(true);
    expect(pointInElement({ x: 3, y: 3 }, ellipse, measurer)).toBe(false);
    expect(pointInElement({ x: 70, y: 40 }, circle, measurer)).toBe(true);
    expect(pointInElement({ x: 5, y: 40 }, circle, measurer)).toBe(false);
  });

  it('creates lead points before curving between anchors', () => {
    const source = getElementAnchors(baseElement, measurer).find((anchor) => anchor.side === 'right')!;
    const target = getElementAnchors({ ...baseElement, id: 'b', x: 260 }, measurer).find((anchor) => anchor.side === 'left')!;
    const path = createConnectionPath(source, target);

    expect(path.sourceLeadPoint).toEqual({ x: source.x + 32, y: source.y });
    expect(path.targetLeadPoint).toEqual({ x: target.x - 32, y: target.y });
    expect(path.samplePoints[0]).toEqual(expect.objectContaining({ x: source.x, y: source.y }));
    expect(path.samplePoints[path.samplePoints.length - 1]).toEqual(expect.objectContaining({ x: target.x, y: target.y }));
  });

  it('builds connection paths from source and target endpoints', () => {
    const elements = [
      { ...baseElement, id: 'a', x: 0, y: 0 },
      { ...baseElement, id: 'b', x: 260, y: 160 },
    ];

    const path = getConnectionPath(connection(), elements, measurer);

    expect(path?.sourceAnchor.side).toBe('right');
    expect(path?.targetAnchor.side).toBe('left');
    expect(path?.samplePoints.length).toBeGreaterThan(10);
  });

  it('calculates arrow angles from terminal path segments', () => {
    const source = getElementAnchors(baseElement, measurer).find((anchor) => anchor.side === 'right')!;
    const target = getElementAnchors({ ...baseElement, id: 'b', x: 260 }, measurer).find((anchor) => anchor.side === 'left')!;
    const path = createConnectionPath(source, target);

    expect(getArrowAngle(path, 'start')).toBeCloseTo(Math.PI);
    expect(getArrowAngle(path, 'end')).toBeCloseTo(0);
  });

  it('measures distance from points to sampled connection paths', () => {
    const source = getElementAnchors(baseElement, measurer).find((anchor) => anchor.side === 'right')!;
    const target = getElementAnchors({ ...baseElement, id: 'b', x: 260 }, measurer).find((anchor) => anchor.side === 'left')!;
    const path = createConnectionPath(source, target);

    expect(distanceToConnection(path.samplePoints[4], path)).toBeCloseTo(0);
    expect(distanceToConnection({ x: source.x, y: source.y + 120 }, path)).toBeGreaterThan(80);
  });

  it('infers target side when creating a new element from blank space', () => {
    expect(inferTargetSide('right')).toBe('left');
    expect(inferTargetSide('left')).toBe('right');
    expect(inferTargetSide('top')).toBe('bottom');
    expect(inferTargetSide('bottom')).toBe('top');
  });

  it('snaps moving elements and returns alignment guides', () => {
    const moving = { ...baseElement, id: 'moving', x: 0, y: 0 };
    const target = { ...baseElement, id: 'target', x: 200, y: 160 };

    const result = snapElement(moving, [moving, target], 205, 60, measurer);

    expect(result.x).toBe(200);
    expect(result.guides.some((guide) => guide.orientation === 'vertical')).toBe(true);
  });

  it('prefers center alignment guides when multiple snap rules match', () => {
    const moving = { ...baseElement, id: 'moving', x: 0, y: 0 };
    const target = { ...baseElement, id: 'target', x: 200, y: 160 };

    const result = snapElement(moving, [moving, target], 195, 60, measurer);

    expect(result.x).toBe(200);
    expect(result.guides.some((guide) => guide.orientation === 'vertical' && guide.position === 260)).toBe(true);
  });

  it('snaps preview points to horizontal and vertical axes from the source anchor', () => {
    const source = getElementAnchors(baseElement, measurer).find((anchor) => anchor.side === 'right')!;

    expect(snapPreviewPoint(source, { x: source.x + 160, y: source.y + 8 })).toEqual({
      x: source.x + 160,
      y: source.y,
    });
    expect(snapPreviewPoint(source, { x: source.x + 8, y: source.y + 160 })).toEqual({
      x: source.x,
      y: source.y + 160,
    });
    expect(snapPreviewPoint(source, { x: source.x + 160, y: source.y + 24 })).toEqual({
      x: source.x + 160,
      y: source.y + 24,
    });
  });

  it('measures connection creation movement in screen pixels', () => {
    const start = { x: 100, y: 100 };

    expect(hasSignificantPointerMovement(start, { x: 109, y: 100 }, 1, 10)).toBe(false);
    expect(hasSignificantPointerMovement(start, { x: 110, y: 100 }, 1, 10)).toBe(true);
    expect(hasSignificantPointerMovement(start, { x: 105, y: 100 }, 2, 10)).toBe(true);
  });

  it('resizes from the left while keeping the opposite edge fixed', () => {
    const result = resizeElementBox(baseElement, 'left', 40, 0);

    expect(result.x).toBe(50);
    expect(result.width).toBe(80);
    expect(result.x + result.width).toBe(baseElement.x + baseElement.width);
  });

  it('deletes related connections when an element is deleted', () => {
    const elements = [baseElement, { ...baseElement, id: 'b' }];
    const connections = [connection()];
    const result = deleteSelectionFromFlow(elements, connections, { type: 'element', id: 'a' });

    expect(result.elements).toHaveLength(1);
    expect(result.connections).toHaveLength(0);
  });

  it('toggles multiple selected items and deletes the whole selection', () => {
    const elements = [baseElement, { ...baseElement, id: 'b' }, { ...baseElement, id: 'c' }];
    const connections: Connection[] = [
      connection(),
      { ...connection(), id: 'c2', source: { elementId: 'b', side: 'right' }, target: { elementId: 'c', side: 'left' } },
    ];
    const selection = toggleSelection(
      toggleSelection({ type: 'element', id: 'a' }, { type: 'connection', id: 'c2' }),
      { type: 'element', id: 'b' },
    );
    const result = deleteSelectionFromFlow(elements, connections, selection);

    expect(selection?.type).toBe('multi');
    expect(result.elements.map((element) => element.id)).toEqual(['c']);
    expect(result.connections).toHaveLength(0);
  });

  it('supports snapshot undo and redo', () => {
    const history: HistoryState = { past: [], future: [] };
    const first = { elements: [baseElement], connections: [], selection: null };
    const second = { elements: [{ ...baseElement, x: 100 }], connections: [], selection: null };

    pushHistory(history, first);
    expect(undo(history, second)?.elements[0].x).toBe(10);
    expect(redo(history, first)?.elements[0].x).toBe(100);
  });
});
