import { describe, expect, it } from 'vitest';
import type { Connection, FlowElement } from '../types/flow';
import {
  createConnectionPath,
  createPreviewPath,
  distanceToConnection,
  getArrowAngle,
  getConnectionLabelBox,
  getConnectionPath,
  getElementAnchors,
  getFlowBounds,
  getTextOffset,
  hasSignificantPointerMovement,
  inferPreviewTargetSide,
  inferTargetSide,
  layoutElementText,
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
    pathType: 'curve',
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

  it('measures fit-content elements from manual multiline text', () => {
    const size = measureFitContent(
      {
        ...baseElement,
        sizeMode: 'fit-content',
        text: 'One\nLonger line',
        padding: 8,
        borderWidth: 1,
      },
      measurer,
    );

    expect(size.width).toBe(106);
    expect(size.height).toBe(58);
  });

  it('wraps element text to a fixed content width', () => {
    expect(layoutElementText('Alpha Beta Gamma', 56, measurer).lines).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(layoutElementText('One\nTwo', 120, measurer).lines).toEqual(['One', 'Two']);
    expect(layoutElementText('abcdefgh', 24, measurer).lines).toEqual(['abc', 'def', 'gh']);
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

  it('places circle anchors on the visible circle when the box is not square', () => {
    const circle: FlowElement = { ...baseElement, shape: 'circle', x: 0, y: 0, width: 140, height: 80 };
    const anchors = getElementAnchors(circle, measurer);

    expect(anchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ side: 'top', x: 70, y: 0 }),
        expect.objectContaining({ side: 'right', x: 110, y: 40 }),
        expect.objectContaining({ side: 'bottom', x: 70, y: 80 }),
        expect.objectContaining({ side: 'left', x: 30, y: 40 }),
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

  it('hit-tests rounded rectangles by their rounded visual corners', () => {
    const rounded: FlowElement = { ...baseElement, shape: 'rounded-rect', x: 0, y: 0, width: 120, height: 60, borderRadius: 20 };

    expect(pointInElement({ x: 60, y: 30 }, rounded, measurer)).toBe(true);
    expect(pointInElement({ x: 12, y: 12 }, rounded, measurer)).toBe(true);
    expect(pointInElement({ x: 3, y: 3 }, rounded, measurer)).toBe(false);
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

  it('builds curve connection paths from source and target endpoints by default', () => {
    const elements = [
      { ...baseElement, id: 'a', x: 0, y: 0 },
      { ...baseElement, id: 'b', x: 260, y: 160 },
    ];

    const path = getConnectionPath(connection(), elements, measurer);

    expect(path?.sourceAnchor.side).toBe('right');
    expect(path?.targetAnchor.side).toBe('left');
    expect(path?.samplePoints[0]).toEqual(expect.objectContaining(path!.sourceAnchor));
    expect(path?.samplePoints[path.samplePoints.length - 1]).toEqual(expect.objectContaining(path!.targetAnchor));
    expect(path?.samplePoints.length).toBeGreaterThan(20);
  });

  it('routes orthogonal connection paths around blocking elements', () => {
    const elements = [
      { ...baseElement, id: 'a', x: 0, y: 0 },
      { ...baseElement, id: 'b', x: 320, y: 0 },
      { ...baseElement, id: 'blocker', x: 160, y: -20, width: 80, height: 100 },
    ];
    const path = getConnectionPath({ ...connection(), pathType: 'orthogonal' }, elements, measurer)!;

    expect(path.samplePoints.some((point) => point.y < -44 || point.y > 124)).toBe(true);
    expect(
      path.samplePoints.some((point) => point.x > 160 && point.x < 240 && point.y > -20 && point.y < 80),
    ).toBe(false);
  });

  it('uses a simple L-shaped orthogonal route when no obstacle blocks the path', () => {
    const elements = [
      { ...baseElement, id: 'a', x: 0, y: 220 },
      { ...baseElement, id: 'b', x: 260, y: 0 },
    ];
    const path = getConnectionPath({ ...connection(), pathType: 'orthogonal' }, elements, measurer)!;

    expect(path.samplePoints.length).toBeLessThanOrEqual(5);
    expect(path.samplePoints.every((point, index, points) => {
      if (index === 0) return true;
      const previous = points[index - 1];
      return point.x === previous.x || point.y === previous.y;
    })).toBe(true);
  });

  it('creates preview paths that match the selected connection path style', () => {
    const source = getElementAnchors(baseElement, measurer).find((anchor) => anchor.side === 'right')!;
    const curvePath = createPreviewPath(source, { x: source.x + 140, y: source.y + 60 }, 'curve');
    const orthogonalPath = createPreviewPath(source, { x: source.x + 140, y: source.y + 60 }, 'orthogonal');

    expect(curvePath.samplePoints.length).toBeGreaterThan(20);
    expect(orthogonalPath.samplePoints.length).toBeLessThan(curvePath.samplePoints.length);
    expect(orthogonalPath.samplePoints.every((point, index, points) => {
      if (index === 0) return true;
      const previous = points[index - 1];
      return point.x === previous.x || point.y === previous.y;
    })).toBe(true);
  });

  it('calculates connection label boxes from text position and measured text', () => {
    const elements = [
      { ...baseElement, id: 'a', x: 0, y: 0 },
      { ...baseElement, id: 'b', x: 260, y: 160 },
    ];
    const labeledConnection = { ...connection(), text: 'Review', textPosition: 'above' as const };
    const path = getConnectionPath(labeledConnection, elements, measurer)!;
    const labelBox = getConnectionLabelBox(labeledConnection, path, measurer)!;
    const offset = getTextOffset(labeledConnection.textPosition, path.textAngle);

    expect(labelBox.width).toBe(64);
    expect(labelBox.height).toBe(20);
    expect(labelBox.x + labelBox.width / 2).toBeCloseTo(path.labelPoint.x + offset.x);
    expect(labelBox.y + labelBox.height / 2).toBeCloseTo(path.labelPoint.y + offset.y);
  });

  it('calculates connection label boxes from multiline text', () => {
    const elements = [
      { ...baseElement, id: 'a', x: 0, y: 0 },
      { ...baseElement, id: 'b', x: 260, y: 160 },
    ];
    const labeledConnection = { ...connection(), text: 'Go\nBacklog', textPosition: 'middle' as const };
    const path = getConnectionPath(labeledConnection, elements, measurer)!;
    const labelBox = getConnectionLabelBox(labeledConnection, path, measurer)!;

    expect(labelBox.width).toBe(72);
    expect(labelBox.height).toBe(40);
    expect(labelBox.x + labelBox.width / 2).toBeCloseTo(path.labelPoint.x);
    expect(labelBox.y + labelBox.height / 2).toBeCloseTo(path.labelPoint.y);
  });

  it('calculates flow bounds from the provided export content', () => {
    const elements = [
      { ...baseElement, id: 'a', x: 0, y: 0 },
      { ...baseElement, id: 'b', x: 260, y: 160 },
    ];
    const bounds = getFlowBounds(elements, [connection()], measurer);

    expect(bounds).toEqual(expect.objectContaining({ minX: 0, minY: 0, maxX: 380, maxY: 220 }));
  });

  it('ignores connections whose endpoints are not in the provided bounds content', () => {
    const elements = [{ ...baseElement, id: 'a', x: 0, y: 0 }];
    const bounds = getFlowBounds(elements, [connection()], measurer);

    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 120, maxY: 60 });
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

  it('snaps moving elements at the exact alignment threshold', () => {
    const moving = { ...baseElement, id: 'moving', x: 0, y: 0 };
    const target = { ...baseElement, id: 'target', x: 200, y: 160 };

    const result = snapElement(moving, [moving, target], 206, 60, measurer);

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

  it('keeps center alignment guides ahead of closer edge rules', () => {
    const moving = { ...baseElement, id: 'moving', x: 0, y: 0 };
    const target = { ...baseElement, id: 'target', x: 200, y: 160 };

    const result = snapElement(moving, [moving, target], 194, 60, measurer);

    expect(result.x).toBe(200);
    expect(result.guides).toContainEqual(expect.objectContaining({ orientation: 'vertical', position: 260 }));
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

  it('snaps preview points to nearby element center axes', () => {
    const source = getElementAnchors(baseElement, measurer).find((anchor) => anchor.side === 'right')!;
    const target = { ...baseElement, id: 'target', x: 300, y: 200 };

    expect(snapPreviewPoint(source, { x: 366, y: 236 }, 1, [baseElement, target], measurer)).toEqual({
      x: 360,
      y: 230,
    });
  });

  it('prefers preview center axes over closer element edge axes', () => {
    const source = getElementAnchors(baseElement, measurer).find((anchor) => anchor.side === 'right')!;
    const target = { ...baseElement, id: 'target', x: 300, y: 200, height: 20 };

    expect(snapPreviewPoint(source, { x: 366, y: 218 }, 1, [baseElement, target], measurer)).toEqual({
      x: 360,
      y: 210,
    });
  });

  it('keeps preview axis snapping stable in screen pixels while zoomed', () => {
    const source = getElementAnchors(baseElement, measurer).find((anchor) => anchor.side === 'right')!;

    expect(snapPreviewPoint(source, { x: source.x + 160, y: source.y + 7 }, 2)).toEqual({
      x: source.x + 160,
      y: source.y + 7,
    });
    expect(snapPreviewPoint(source, { x: source.x + 160, y: source.y + 6 }, 2)).toEqual({
      x: source.x + 160,
      y: source.y,
    });
  });

  it('infers preview target side from the dominant drag direction', () => {
    const source = getElementAnchors(baseElement, measurer).find((anchor) => anchor.side === 'bottom')!;

    expect(inferPreviewTargetSide(source, { x: source.x + 120, y: source.y + 24 })).toBe('left');
    expect(inferPreviewTargetSide(source, { x: source.x - 120, y: source.y + 24 })).toBe('right');
    expect(inferPreviewTargetSide(source, { x: source.x + 24, y: source.y + 120 })).toBe('top');
    expect(createPreviewPath(source, { x: source.x + 120, y: source.y + 24 }).targetAnchor.side).toBe('left');
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
