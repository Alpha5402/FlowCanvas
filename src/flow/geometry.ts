import type {
  AlignmentGuide,
  Anchor,
  AnchorSide,
  Connection,
  ConnectionEndpoint,
  FlowElement,
  Point,
  ResizeHandle,
} from '../types/flow';

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
  sourceAnchor: Anchor;
  sourceLeadPoint: Point;
  targetLeadPoint: Point;
  targetAnchor: Anchor;
  control1: Point;
  control2: Point;
  labelPoint: Point;
  textAngle: number;
  samplePoints: Point[];
}

export interface SnapResult {
  x: number;
  y: number;
  guides: AlignmentGuide[];
}

export interface ResizeResult {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FONT_SIZE = 14;
const LINE_HEIGHT = 20;
const SNAP_DISTANCE = 6;
const PREVIEW_AXIS_SNAP_DISTANCE = 12;
const LEAD_DISTANCE = 32;
export const MIN_ELEMENT_WIDTH = 48;
export const MIN_ELEMENT_HEIGHT = 32;
export const ANCHOR_HANDLE_OFFSET = 0;

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

export function getAnchorNormal(side: AnchorSide): Point {
  if (side === 'top') return { x: 0, y: -1 };
  if (side === 'right') return { x: 1, y: 0 };
  if (side === 'bottom') return { x: 0, y: 1 };
  return { x: -1, y: 0 };
}

export function getElementAnchors(element: FlowElement, measurer?: Measurer): Anchor[] {
  const box = getElementBox(element, measurer);
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const radius = Math.min(box.width, box.height) / 2;
  const left = element.shape === 'circle' ? centerX - radius : box.x;
  const right = element.shape === 'circle' ? centerX + radius : box.x + box.width;
  const top = element.shape === 'circle' ? centerY - radius : box.y;
  const bottom = element.shape === 'circle' ? centerY + radius : box.y + box.height;
  const anchors: Array<[AnchorSide, Point]> = [
    ['top', { x: centerX, y: top }],
    ['right', { x: right, y: centerY }],
    ['bottom', { x: centerX, y: bottom }],
    ['left', { x: left, y: centerY }],
  ];

  return anchors.map(([side, point]) => ({
    elementId: element.id,
    side,
    x: point.x,
    y: point.y,
    normalVector: getAnchorNormal(side),
  }));
}

export function getAnchorHandlePoint(anchor: Anchor): Point {
  return {
    x: anchor.x + anchor.normalVector.x * ANCHOR_HANDLE_OFFSET,
    y: anchor.y + anchor.normalVector.y * ANCHOR_HANDLE_OFFSET,
  };
}

export function resolveConnectionEndpoint(
  connection: Connection,
  end: 'source' | 'target',
): ConnectionEndpoint {
  const endpoint = connection[end];
  if (endpoint) return endpoint;
  return {
    elementId: end === 'source' ? connection.sourceElementId ?? '' : connection.targetElementId ?? '',
    side: end === 'source' ? 'right' : 'left',
  };
}

export function normalizeConnection(connection: Connection): Connection {
  return {
    ...connection,
    source: resolveConnectionEndpoint(connection, 'source'),
    target: resolveConnectionEndpoint(connection, 'target'),
  };
}

export function findAnchor(
  elements: FlowElement[],
  endpoint: ConnectionEndpoint,
  measurer?: Measurer,
): Anchor | null {
  const element = elements.find((item) => item.id === endpoint.elementId);
  if (!element) return null;
  return getElementAnchors(element, measurer).find((anchor) => anchor.side === endpoint.side) ?? null;
}

export function getConnectionPath(
  connection: Connection,
  elements: FlowElement[],
  measurer?: Measurer,
): ConnectionPath | null {
  const normalized = normalizeConnection(connection);
  const sourceAnchor = findAnchor(elements, normalized.source, measurer);
  const targetAnchor = findAnchor(elements, normalized.target, measurer);
  if (!sourceAnchor || !targetAnchor) return null;
  return createConnectionPath(sourceAnchor, targetAnchor);
}

export function createConnectionPath(sourceAnchor: Anchor, targetAnchor: Anchor): ConnectionPath {
  const sourceLeadPoint = add(sourceAnchor, multiply(sourceAnchor.normalVector, LEAD_DISTANCE));
  const targetLeadPoint = add(targetAnchor, multiply(targetAnchor.normalVector, LEAD_DISTANCE));
  const distance = Math.hypot(targetLeadPoint.x - sourceLeadPoint.x, targetLeadPoint.y - sourceLeadPoint.y);
  const controlDistance = Math.max(40, Math.min(180, distance * 0.38));
  const control1 = add(sourceLeadPoint, multiply(sourceAnchor.normalVector, controlDistance));
  const control2 = add(targetLeadPoint, multiply(targetAnchor.normalVector, controlDistance));
  const labelPoint = cubicPoint(sourceLeadPoint, control1, control2, targetLeadPoint, 0.5);
  const tangent = cubicTangent(sourceLeadPoint, control1, control2, targetLeadPoint, 0.5);

  return {
    sourceAnchor,
    sourceLeadPoint,
    targetLeadPoint,
    targetAnchor,
    control1,
    control2,
    labelPoint,
    textAngle: Math.atan2(tangent.y, tangent.x),
    samplePoints: sampleConnectionPath(sourceAnchor, sourceLeadPoint, control1, control2, targetLeadPoint, targetAnchor),
  };
}

export function createPreviewPath(sourceAnchor: Anchor, pointer: Point): ConnectionPath {
  const side = inferTargetSide(sourceAnchor.side);
  const targetAnchor: Anchor = {
    elementId: '__preview__',
    side,
    x: pointer.x,
    y: pointer.y,
    normalVector: getAnchorNormal(side),
  };
  return createConnectionPath(sourceAnchor, targetAnchor);
}

export function snapPreviewPoint(sourceAnchor: Anchor, pointer: Point): Point {
  const snapped = { ...pointer };
  const dx = pointer.x - sourceAnchor.x;
  const dy = pointer.y - sourceAnchor.y;

  if (Math.abs(dy) <= PREVIEW_AXIS_SNAP_DISTANCE && Math.abs(dx) > Math.abs(dy)) {
    snapped.y = sourceAnchor.y;
  }
  if (Math.abs(dx) <= PREVIEW_AXIS_SNAP_DISTANCE && Math.abs(dy) > Math.abs(dx)) {
    snapped.x = sourceAnchor.x;
  }

  return snapped;
}

export function hasSignificantPointerMovement(
  start: Point,
  end: Point,
  zoom: number,
  thresholdInScreenPixels: number,
): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y) * zoom >= thresholdInScreenPixels;
}

export function inferTargetSide(sourceSide: AnchorSide): AnchorSide {
  if (sourceSide === 'right') return 'left';
  if (sourceSide === 'left') return 'right';
  if (sourceSide === 'top') return 'bottom';
  return 'top';
}

export function getArrowAngle(path: ConnectionPath, at: 'start' | 'end'): number {
  if (at === 'start') {
    return Math.atan2(
      path.sourceAnchor.y - path.sourceLeadPoint.y,
      path.sourceAnchor.x - path.sourceLeadPoint.x,
    );
  }
  return Math.atan2(
    path.targetAnchor.y - path.targetLeadPoint.y,
    path.targetAnchor.x - path.targetLeadPoint.x,
  );
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
  let bestVertical: SnapCandidate | null = null;
  let bestHorizontal: SnapCandidate | null = null;

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
          const candidate = { diff, guide, priority: centerPriority(movingKey, otherKey) };
          if (shouldUseSnapCandidate(bestVertical, candidate)) {
            bestVertical = candidate;
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
          const candidate = { diff, guide, priority: centerPriority(movingKey, otherKey) };
          if (shouldUseSnapCandidate(bestHorizontal, candidate)) {
            bestHorizontal = candidate;
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

type SnapCandidate = {
  diff: number;
  guide: AlignmentGuide;
  priority: number;
};

export function resizeElementBox(
  original: FlowElement,
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
): ResizeResult {
  let { x, y, width, height } = original;
  const right = x + width;
  const bottom = y + height;

  if (handle.includes('right')) width += deltaX;
  if (handle.includes('bottom')) height += deltaY;
  if (handle.includes('left')) {
    x += deltaX;
    width -= deltaX;
  }
  if (handle.includes('top')) {
    y += deltaY;
    height -= deltaY;
  }

  if (width < MIN_ELEMENT_WIDTH) {
    width = MIN_ELEMENT_WIDTH;
    if (handle.includes('left')) x = right - width;
  }
  if (height < MIN_ELEMENT_HEIGHT) {
    height = MIN_ELEMENT_HEIGHT;
    if (handle.includes('top')) y = bottom - height;
  }

  return { x, y, width, height };
}

export function getResizeHandles(element: FlowElement, measurer?: Measurer): Array<{ handle: ResizeHandle; point: Point }> {
  const box = getElementBox(element, measurer);
  return [
    { handle: 'top-left', point: { x: box.x, y: box.y } },
    { handle: 'top', point: { x: box.x + box.width / 2, y: box.y } },
    { handle: 'top-right', point: { x: box.x + box.width, y: box.y } },
    { handle: 'right', point: { x: box.x + box.width, y: box.y + box.height / 2 } },
    { handle: 'bottom-right', point: { x: box.x + box.width, y: box.y + box.height } },
    { handle: 'bottom', point: { x: box.x + box.width / 2, y: box.y + box.height } },
    { handle: 'bottom-left', point: { x: box.x, y: box.y + box.height } },
    { handle: 'left', point: { x: box.x, y: box.y + box.height / 2 } },
  ];
}

export function pointInElement(point: Point, element: FlowElement, measurer?: Measurer): boolean {
  const box = getElementBox(element, measurer);
  const insideBox = point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
  if (!insideBox) return false;
  if (element.shape !== 'ellipse' && element.shape !== 'circle') return true;

  const radiusX = element.shape === 'circle' ? Math.min(box.width, box.height) / 2 : box.width / 2;
  const radiusY = element.shape === 'circle' ? radiusX : box.height / 2;
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  return ((point.x - centerX) / radiusX) ** 2 + ((point.y - centerY) / radiusY) ** 2 <= 1;
}

export function distanceToConnection(point: Point, path: ConnectionPath): number {
  let shortest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < path.samplePoints.length; index += 1) {
    shortest = Math.min(shortest, distanceToLineSegment(point, path.samplePoints[index - 1], path.samplePoints[index]));
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

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function sampleConnectionPath(
  sourceAnchor: Point,
  sourceLeadPoint: Point,
  control1: Point,
  control2: Point,
  targetLeadPoint: Point,
  targetAnchor: Point,
): Point[] {
  const points = [sourceAnchor, sourceLeadPoint];
  for (let index = 1; index <= 28; index += 1) {
    points.push(cubicPoint(sourceLeadPoint, control1, control2, targetLeadPoint, index / 28));
  }
  points.push(targetAnchor);
  return points;
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

function centerPriority(first: string, second: string): number {
  return Number(isCenterAnchor(first)) + Number(isCenterAnchor(second));
}

function isCenterAnchor(key: string): boolean {
  return key === 'centerX' || key === 'centerY';
}

function shouldUseSnapCandidate(current: SnapCandidate | null, candidate: SnapCandidate): boolean {
  if (!current) return true;
  if (candidate.priority !== current.priority) return candidate.priority > current.priority;
  return Math.abs(candidate.diff) < Math.abs(current.diff);
}

function cubicPoint(start: Point, control1: Point, control2: Point, end: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt ** 3 * start.x + 3 * mt ** 2 * t * control1.x + 3 * mt * t ** 2 * control2.x + t ** 3 * end.x,
    y: mt ** 3 * start.y + 3 * mt ** 2 * t * control1.y + 3 * mt * t ** 2 * control2.y + t ** 3 * end.y,
  };
}

function cubicTangent(start: Point, control1: Point, control2: Point, end: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: 3 * mt ** 2 * (control1.x - start.x) + 6 * mt * t * (control2.x - control1.x) + 3 * t ** 2 * (end.x - control2.x),
    y: 3 * mt ** 2 * (control1.y - start.y) + 6 * mt * t * (control2.y - control1.y) + 3 * t ** 2 * (end.y - control2.y),
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

function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

function multiply(point: Point, value: number): Point {
  return { x: point.x * value, y: point.y * value };
}

function estimateTextWidth(text: string): number {
  return Math.max(1, text.length) * FONT_SIZE * 0.58;
}
