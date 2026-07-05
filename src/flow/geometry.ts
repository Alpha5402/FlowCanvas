import type { AlignmentGuide, Connection, FlowElement, Point } from '../types/flow';

export interface Measurer {
  measureText(text: string): { width: number };
}

export interface ElementBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ConnectionPath {
  start: Point;
  end: Point;
  control: Point | null;
  isStraight: boolean;
  textPoint: Point;
  textAngle: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: AlignmentGuide[];
}

const FONT_SIZE = 14;
const LINE_HEIGHT = 20;
const SNAP_DISTANCE = 6;
const STRAIGHT_TOLERANCE = 8;

export function getElementBox(element: FlowElement, measurer?: Measurer): ElementBox {
  if (element.sizeMode === 'fit-content') {
    return {
      x: element.x,
      y: element.y,
      ...measureFitContent(element, measurer),
    };
  }

  return {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
  };
}

export function measureFitContent(element: FlowElement, measurer?: Measurer): Pick<ElementBox, 'width' | 'height'> {
  const measured = measurer?.measureText(element.text).width ?? estimateTextWidth(element.text);
  const border = element.borderWidth * 2;
  const width = Math.max(64, Math.ceil(measured + element.padding * 2 + border));
  const height = Math.max(42, Math.ceil(LINE_HEIGHT + element.padding * 2 + border));

  if (element.shape === 'circle') {
    const side = Math.max(width, height);
    return { width: side, height: side };
  }

  return { width, height };
}

export function getCenter(element: FlowElement, measurer?: Measurer): Point {
  const box = getElementBox(element, measurer);
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

export function getConnectionPath(
  connection: Connection,
  elements: FlowElement[],
  measurer?: Measurer,
): ConnectionPath | null {
  const source = elements.find((element) => element.id === connection.sourceElementId);
  const target = elements.find((element) => element.id === connection.targetElementId);
  if (!source || !target) return null;

  const start = getCenter(source, measurer);
  const end = getCenter(target, measurer);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const isStraight = Math.abs(dx) < STRAIGHT_TOLERANCE || Math.abs(dy) < STRAIGHT_TOLERANCE;
  const control = isStraight
    ? null
    : {
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2 - Math.min(90, Math.max(36, Math.abs(dx) * 0.18)),
      };
  const textPoint = control
    ? quadraticPoint(start, control, end, 0.5)
    : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const tangent = control
    ? quadraticTangent(start, control, end, 0.5)
    : { x: dx, y: dy };

  return {
    start,
    end,
    control,
    isStraight,
    textPoint,
    textAngle: Math.atan2(tangent.y, tangent.x),
  };
}

export function getArrowAngle(path: ConnectionPath, at: 'start' | 'end'): number {
  if (!path.control) {
    return Math.atan2(path.end.y - path.start.y, path.end.x - path.start.x) + (at === 'start' ? Math.PI : 0);
  }

  const tangent =
    at === 'start'
      ? quadraticTangent(path.start, path.control, path.end, 0.02)
      : quadraticTangent(path.start, path.control, path.end, 0.98);
  return Math.atan2(tangent.y, tangent.x) + (at === 'start' ? Math.PI : 0);
}

export function snapElement(
  moving: FlowElement,
  elements: FlowElement[],
  proposedX: number,
  proposedY: number,
  measurer?: Measurer,
): SnapResult {
  const movingBox = getElementBox({ ...moving, x: proposedX, y: proposedY }, measurer);
  const movingAnchors = boxAnchors(movingBox);
  let bestVertical: { diff: number; guide: AlignmentGuide } | null = null;
  let bestHorizontal: { diff: number; guide: AlignmentGuide } | null = null;

  for (const other of elements) {
    if (other.id === moving.id) continue;
    const otherBox = getElementBox(other, measurer);
    const otherAnchors = boxAnchors(otherBox);

    for (const movingKey of ['left', 'centerX', 'right'] as const) {
      for (const otherKey of ['left', 'centerX', 'right'] as const) {
        const diff = otherAnchors[otherKey] - movingAnchors[movingKey];
        if (Math.abs(diff) < SNAP_DISTANCE) {
          const guide = {
            orientation: 'vertical',
            position: otherAnchors[otherKey],
            from: Math.min(otherBox.y, proposedY) - 36,
            to: Math.max(otherBox.y + otherBox.height, proposedY + movingBox.height) + 36,
          } satisfies AlignmentGuide;
          if (!bestVertical || Math.abs(diff) < Math.abs(bestVertical.diff)) {
            bestVertical = { diff, guide };
          }
        }
      }
    }

    for (const movingKey of ['top', 'centerY', 'bottom'] as const) {
      for (const otherKey of ['top', 'centerY', 'bottom'] as const) {
        const diff = otherAnchors[otherKey] - movingAnchors[movingKey];
        if (Math.abs(diff) < SNAP_DISTANCE) {
          const guide = {
            orientation: 'horizontal',
            position: otherAnchors[otherKey],
            from: Math.min(otherBox.x, proposedX) - 36,
            to: Math.max(otherBox.x + otherBox.width, proposedX + movingBox.width) + 36,
          } satisfies AlignmentGuide;
          if (!bestHorizontal || Math.abs(diff) < Math.abs(bestHorizontal.diff)) {
            bestHorizontal = { diff, guide };
          }
        }
      }
    }
  }

  return {
    x: proposedX + (bestVertical?.diff ?? 0),
    y: proposedY + (bestHorizontal?.diff ?? 0),
    guides: [bestVertical?.guide, bestHorizontal?.guide].filter((guide): guide is AlignmentGuide => Boolean(guide)),
  };
}

export function pointInElement(point: Point, element: FlowElement, measurer?: Measurer): boolean {
  const box = getElementBox(element, measurer);
  return point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
}

export function distanceToConnection(point: Point, path: ConnectionPath): number {
  if (!path.control) {
    return distanceToLineSegment(point, path.start, path.end);
  }

  let shortest = Number.POSITIVE_INFINITY;
  let previous = path.start;
  for (let index = 1; index <= 24; index += 1) {
    const current = quadraticPoint(path.start, path.control, path.end, index / 24);
    shortest = Math.min(shortest, distanceToLineSegment(point, previous, current));
    previous = current;
  }
  return shortest;
}

export function getTextOffset(position: Connection['textPosition'], angle: number): Point {
  if (position === 'middle') return { x: 0, y: 0 };
  const normal = { x: -Math.sin(angle), y: Math.cos(angle) };
  const direction = position === 'above' ? -1 : 1;
  return {
    x: normal.x * 18 * direction,
    y: normal.y * 18 * direction,
  };
}

function boxAnchors(box: ElementBox) {
  return {
    left: box.x,
    centerX: box.x + box.width / 2,
    right: box.x + box.width,
    top: box.y,
    centerY: box.y + box.height / 2,
    bottom: box.y + box.height,
  };
}

function quadraticPoint(start: Point, control: Point, end: Point, t: number): Point {
  const oneMinusT = 1 - t;
  return {
    x: oneMinusT * oneMinusT * start.x + 2 * oneMinusT * t * control.x + t * t * end.x,
    y: oneMinusT * oneMinusT * start.y + 2 * oneMinusT * t * control.y + t * t * end.y,
  };
}

function quadraticTangent(start: Point, control: Point, end: Point, t: number): Point {
  return {
    x: 2 * (1 - t) * (control.x - start.x) + 2 * t * (end.x - control.x),
    y: 2 * (1 - t) * (control.y - start.y) + 2 * t * (end.y - control.y),
  };
}

function distanceToLineSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function estimateTextWidth(text: string): number {
  return Math.max(1, text.length) * FONT_SIZE * 0.58;
}
