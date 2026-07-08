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

export interface FlowBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface TextBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextLayout {
  lines: string[];
  width: number;
  height: number;
  lineHeight: number;
}

const FONT_SIZE = 14;
const LINE_HEIGHT = 20;
const SNAP_DISTANCE = 6;
const PREVIEW_AXIS_SNAP_DISTANCE = 12;
const LEAD_DISTANCE = 32;
const ROUTE_PADDING = 24;
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
  const layout = layoutElementText(element.text, undefined, measurer);
  const border = element.borderWidth * 2;
  const width = Math.max(64, Math.ceil(layout.width + element.padding * 2 + border));
  const height = Math.max(42, Math.ceil(layout.height + element.padding * 2 + border));

  if (element.shape === 'circle') {
    const side = Math.max(width, height);
    return { width: side, height: side };
  }

  return { width, height };
}

export function layoutElementText(text: string, maxWidth?: number, measurer?: Measurer): TextLayout {
  const paragraphs = text.split('\n');
  const lines: string[] = [];
  const constrainedWidth = maxWidth !== undefined ? Math.max(1, maxWidth) : undefined;

  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    if (constrainedWidth === undefined) {
      lines.push(paragraph);
      continue;
    }
    lines.push(...wrapParagraph(paragraph, constrainedWidth, measurer));
  }

  const normalizedLines = lines.length > 0 ? lines : [''];
  const width = normalizedLines.reduce((maximum, line) => Math.max(maximum, measureTextWidth(line, measurer)), 0);
  return {
    lines: normalizedLines,
    width,
    height: normalizedLines.length * LINE_HEIGHT,
    lineHeight: LINE_HEIGHT,
  };
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
  if ((connection.pathType ?? 'curve') === 'curve') return createConnectionPath(sourceAnchor, targetAnchor);
  return createOrthogonalConnectionPath(sourceAnchor, targetAnchor, elements, measurer);
}

export function createOrthogonalConnectionPath(
  sourceAnchor: Anchor,
  targetAnchor: Anchor,
  elements: FlowElement[] = [],
  measurer?: Measurer,
): ConnectionPath {
  const sourceLeadPoint = add(sourceAnchor, multiply(sourceAnchor.normalVector, LEAD_DISTANCE));
  const targetLeadPoint = add(targetAnchor, multiply(targetAnchor.normalVector, LEAD_DISTANCE));
  const routePoints = buildOrthogonalRoute(sourceAnchor, sourceLeadPoint, targetLeadPoint, targetAnchor, elements, measurer);
  return createPolylineConnectionPath(sourceAnchor, sourceLeadPoint, targetLeadPoint, targetAnchor, routePoints);
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

function createPolylineConnectionPath(
  sourceAnchor: Anchor,
  sourceLeadPoint: Point,
  targetLeadPoint: Point,
  targetAnchor: Anchor,
  routePoints: Point[],
): ConnectionPath {
  const samplePoints = dedupeAdjacentPoints([sourceAnchor, ...routePoints, targetAnchor]);
  const middleIndex = Math.floor((samplePoints.length - 1) / 2);
  const labelPoint = midpoint(samplePoints[middleIndex], samplePoints[middleIndex + 1] ?? samplePoints[middleIndex]);
  const tangentStart = samplePoints[middleIndex];
  const tangentEnd = samplePoints[middleIndex + 1] ?? samplePoints[middleIndex];

  return {
    sourceAnchor,
    sourceLeadPoint,
    targetLeadPoint,
    targetAnchor,
    control1: sourceLeadPoint,
    control2: targetLeadPoint,
    labelPoint,
    textAngle: Math.atan2(tangentEnd.y - tangentStart.y, tangentEnd.x - tangentStart.x),
    samplePoints,
  };
}

function buildOrthogonalRoute(
  sourceAnchor: Anchor,
  sourceLeadPoint: Point,
  targetLeadPoint: Point,
  targetAnchor: Anchor,
  elements: FlowElement[],
  measurer?: Measurer,
): Point[] {
  const direct = chooseOrthogonalRoute(
    orthogonalRouteCandidates(sourceAnchor, sourceLeadPoint, targetLeadPoint, targetAnchor),
    sourceAnchor.elementId,
    targetAnchor.elementId,
    elements,
    measurer,
  );
  if (direct) return direct;

  const boxes = elements
    .filter((element) => element.id !== sourceAnchor.elementId && element.id !== targetAnchor.elementId)
    .map((element) => inflateBox(getElementBox(element, measurer), ROUTE_PADDING));
  const minY = Math.min(sourceLeadPoint.y, targetLeadPoint.y, ...boxes.map((box) => box.y));
  const maxY = Math.max(sourceLeadPoint.y, targetLeadPoint.y, ...boxes.map((box) => box.y + box.height));
  const minX = Math.min(sourceLeadPoint.x, targetLeadPoint.x, ...boxes.map((box) => box.x));
  const maxX = Math.max(sourceLeadPoint.x, targetLeadPoint.x, ...boxes.map((box) => box.x + box.width));
  const candidates = [
    [sourceLeadPoint, { x: sourceLeadPoint.x, y: minY - ROUTE_PADDING }, { x: targetLeadPoint.x, y: minY - ROUTE_PADDING }, targetLeadPoint],
    [sourceLeadPoint, { x: sourceLeadPoint.x, y: maxY + ROUTE_PADDING }, { x: targetLeadPoint.x, y: maxY + ROUTE_PADDING }, targetLeadPoint],
    [sourceLeadPoint, { x: minX - ROUTE_PADDING, y: sourceLeadPoint.y }, { x: minX - ROUTE_PADDING, y: targetLeadPoint.y }, targetLeadPoint],
    [sourceLeadPoint, { x: maxX + ROUTE_PADDING, y: sourceLeadPoint.y }, { x: maxX + ROUTE_PADDING, y: targetLeadPoint.y }, targetLeadPoint],
  ];

  return chooseOrthogonalRoute(candidates, sourceAnchor.elementId, targetAnchor.elementId, elements, measurer)
    ?? orthogonalRouteCandidates(sourceAnchor, sourceLeadPoint, targetLeadPoint, targetAnchor)[0];
}

export function createPreviewPath(
  sourceAnchor: Anchor,
  pointer: Point,
  pathType: Connection['pathType'] = 'curve',
): ConnectionPath {
  const side = inferPreviewTargetSide(sourceAnchor, pointer);
  const targetAnchor: Anchor = {
    elementId: '__preview__',
    side,
    x: pointer.x,
    y: pointer.y,
    normalVector: getAnchorNormal(side),
  };
  if (pathType === 'orthogonal') return createOrthogonalConnectionPath(sourceAnchor, targetAnchor);
  return createConnectionPath(sourceAnchor, targetAnchor);
}

export function snapPreviewPoint(
  sourceAnchor: Anchor,
  pointer: Point,
  zoom = 1,
  elements: FlowElement[] = [],
  measurer?: Measurer,
): Point {
  const snapped = { ...pointer };
  const dx = pointer.x - sourceAnchor.x;
  const dy = pointer.y - sourceAnchor.y;
  const snapDistance = PREVIEW_AXIS_SNAP_DISTANCE / Math.max(zoom, 0.01);
  const verticalCandidates: PreviewSnapCandidate[] = [];
  const horizontalCandidates: PreviewSnapCandidate[] = [];

  function addVerticalSnap(position: number, priority: number) {
    const diff = position - pointer.x;
    if (Math.abs(diff) <= snapDistance) {
      verticalCandidates.push({ diff, priority });
    }
  }

  function addHorizontalSnap(position: number, priority: number) {
    const diff = position - pointer.y;
    if (Math.abs(diff) <= snapDistance) {
      horizontalCandidates.push({ diff, priority });
    }
  }

  if (Math.abs(dy) <= snapDistance && Math.abs(dx) > Math.abs(dy)) {
    addHorizontalSnap(sourceAnchor.y, 1);
  }
  if (Math.abs(dx) <= snapDistance && Math.abs(dy) > Math.abs(dx)) {
    addVerticalSnap(sourceAnchor.x, 1);
  }

  for (const element of elements) {
    if (element.id === sourceAnchor.elementId) continue;
    const anchors = boxAnchors(getElementBox(element, measurer));
    addVerticalSnap(anchors.left, 0);
    addVerticalSnap(anchors.centerX, 2);
    addVerticalSnap(anchors.right, 0);
    addHorizontalSnap(anchors.top, 0);
    addHorizontalSnap(anchors.centerY, 2);
    addHorizontalSnap(anchors.bottom, 0);
  }

  snapped.x += chooseSnapCandidate(verticalCandidates)?.diff ?? 0;
  snapped.y += chooseSnapCandidate(horizontalCandidates)?.diff ?? 0;

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

export function inferPreviewTargetSide(sourceAnchor: Anchor, pointer: Point): AnchorSide {
  const dx = pointer.x - sourceAnchor.x;
  const dy = pointer.y - sourceAnchor.y;

  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? 'left' : 'right';
  if (Math.abs(dy) > Math.abs(dx)) return dy >= 0 ? 'top' : 'bottom';
  return inferTargetSide(sourceAnchor.side);
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
        if (Math.abs(diff) <= SNAP_DISTANCE) {
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
        if (Math.abs(diff) <= SNAP_DISTANCE) {
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

type PreviewSnapCandidate = Pick<SnapCandidate, 'diff' | 'priority'>;
type BaseSnapCandidate = Pick<SnapCandidate, 'diff' | 'priority'>;

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
  if (element.shape === 'rounded-rect') return pointInRoundedRect(point, element, box);
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

export function getFlowBounds(
  elements: FlowElement[],
  connections: Connection[],
  measurer?: Measurer,
): FlowBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  function includePoint(point: Point) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  for (const element of elements) {
    const box = getElementBox(element, measurer);
    includePoint({ x: box.x, y: box.y });
    includePoint({ x: box.x + box.width, y: box.y + box.height });
  }

  for (const connection of connections) {
    const path = getConnectionPath(connection, elements, measurer);
    if (!path) continue;
    for (const point of path.samplePoints) includePoint(point);
    const labelBox = getConnectionLabelBox(connection, path, measurer);
    if (labelBox) {
      includePoint({ x: labelBox.x, y: labelBox.y });
      includePoint({ x: labelBox.x + labelBox.width, y: labelBox.y + labelBox.height });
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

export function getConnectionLabelBox(
  connection: Pick<Connection, 'text' | 'textPosition'>,
  path: Pick<ConnectionPath, 'labelPoint' | 'textAngle'>,
  measurer?: Measurer,
): TextBox | null {
  if (!connection.text || !measurer) return null;
  const offset = getTextOffset(connection.textPosition, path.textAngle);
  const textX = path.labelPoint.x + offset.x;
  const textY = path.labelPoint.y + offset.y;
  const layout = layoutElementText(connection.text, undefined, measurer);
  return {
    x: textX - layout.width / 2 - 8,
    y: textY - layout.height / 2,
    width: layout.width + 16,
    height: layout.height,
  };
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

function pointInRoundedRect(point: Point, element: FlowElement, box: ElementBox): boolean {
  const radius = Math.min(element.borderRadius, box.width / 2, box.height / 2);
  if (radius <= 0) return true;

  const innerLeft = box.x + radius;
  const innerRight = box.x + box.width - radius;
  const innerTop = box.y + radius;
  const innerBottom = box.y + box.height - radius;

  const cornerCenterX = point.x < innerLeft ? innerLeft : point.x > innerRight ? innerRight : point.x;
  const cornerCenterY = point.y < innerTop ? innerTop : point.y > innerBottom ? innerBottom : point.y;

  return distance(point, { x: cornerCenterX, y: cornerCenterY }) <= radius;
}

function centerPriority(first: string, second: string): number {
  return Number(isCenterAnchor(first)) + Number(isCenterAnchor(second));
}

function isCenterAnchor(key: string): boolean {
  return key === 'centerX' || key === 'centerY';
}

function shouldUseSnapCandidate<T extends BaseSnapCandidate>(current: T | null, candidate: T): boolean {
  if (!current) return true;
  if (candidate.priority !== current.priority) return candidate.priority > current.priority;
  return Math.abs(candidate.diff) < Math.abs(current.diff);
}

function chooseSnapCandidate<T extends BaseSnapCandidate>(candidates: T[]): T | null {
  let best: T | null = null;
  for (const candidate of candidates) {
    if (shouldUseSnapCandidate(best, candidate)) best = candidate;
  }
  return best;
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

function wrapParagraph(paragraph: string, maxWidth: number, measurer?: Measurer): string[] {
  const tokens = paragraph.match(/\S+\s*/g) ?? [paragraph];
  const lines: string[] = [];
  let current = '';

  for (const token of tokens) {
    const candidate = `${current}${token}`;
    if (measureTextWidth(candidate.trimEnd(), measurer) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current.trimEnd());
    current = '';
    if (measureTextWidth(token.trimEnd(), measurer) <= maxWidth) {
      current = token;
      continue;
    }
    const pieces = wrapLongToken(token.trimEnd(), maxWidth, measurer);
    lines.push(...pieces.slice(0, -1));
    current = pieces[pieces.length - 1] ?? '';
  }

  if (current || lines.length === 0) lines.push(current.trimEnd());
  return lines;
}

function wrapLongToken(token: string, maxWidth: number, measurer?: Measurer): string[] {
  const lines: string[] = [];
  let current = '';
  for (const character of token) {
    const candidate = `${current}${character}`;
    if (!current || measureTextWidth(candidate, measurer) <= maxWidth) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = character;
  }
  if (current) lines.push(current);
  return lines;
}

function measureTextWidth(text: string, measurer?: Measurer): number {
  return measurer?.measureText(text).width ?? estimateTextWidth(text);
}

function estimateTextWidth(text: string): number {
  return Math.max(1, text.length) * FONT_SIZE * 0.58;
}

function orthogonalMiddlePoints(start: Point, end: Point): Point[] {
  if (start.x === end.x || start.y === end.y) return [];
  const midX = (start.x + end.x) / 2;
  return [
    { x: midX, y: start.y },
    { x: midX, y: end.y },
  ];
}

function orthogonalRouteCandidates(
  sourceAnchor: Anchor,
  sourceLeadPoint: Point,
  targetLeadPoint: Point,
  targetAnchor: Anchor,
): Point[][] {
  const candidates: Point[][] = [];
  const sourceFirstCorner = sourceAnchor.side === 'left' || sourceAnchor.side === 'right'
    ? { x: targetLeadPoint.x, y: sourceLeadPoint.y }
    : { x: sourceLeadPoint.x, y: targetLeadPoint.y };
  const targetFirstCorner = targetAnchor.side === 'left' || targetAnchor.side === 'right'
    ? { x: sourceLeadPoint.x, y: targetLeadPoint.y }
    : { x: targetLeadPoint.x, y: sourceLeadPoint.y };

  candidates.push([sourceLeadPoint, sourceFirstCorner, targetLeadPoint]);
  candidates.push([sourceLeadPoint, targetFirstCorner, targetLeadPoint]);
  candidates.push([sourceLeadPoint, ...orthogonalMiddlePoints(sourceLeadPoint, targetLeadPoint), targetLeadPoint]);
  const midY = (sourceLeadPoint.y + targetLeadPoint.y) / 2;
  candidates.push([
    sourceLeadPoint,
    { x: sourceLeadPoint.x, y: midY },
    { x: targetLeadPoint.x, y: midY },
    targetLeadPoint,
  ]);

  const unique = new Map<string, Point[]>();
  for (const candidate of candidates) {
    const route = dedupeAdjacentPoints(candidate);
    unique.set(route.map((point) => `${point.x},${point.y}`).join('|'), route);
  }
  return [...unique.values()];
}

function chooseOrthogonalRoute(
  candidates: Point[][],
  sourceElementId: string,
  targetElementId: string,
  elements: FlowElement[],
  measurer?: Measurer,
): Point[] | null {
  return candidates
    .filter((candidate) => !routeCrossesObstacles(candidate, sourceElementId, targetElementId, elements, measurer))
    .sort((a, b) => routeBendCount(a) - routeBendCount(b) || routeLength(a) - routeLength(b))[0] ?? null;
}

function routeBendCount(points: Point[]): number {
  let bends = 0;
  let previousDirection: 'horizontal' | 'vertical' | null = null;
  for (let index = 1; index < points.length; index += 1) {
    const direction = points[index].x === points[index - 1].x ? 'vertical' : 'horizontal';
    if (previousDirection && direction !== previousDirection) bends += 1;
    previousDirection = direction;
  }
  return bends;
}

function routeCrossesObstacles(
  routePoints: Point[],
  sourceElementId: string,
  targetElementId: string,
  elements: FlowElement[],
  measurer?: Measurer,
): boolean {
  const obstacles = elements
    .filter((element) => element.id !== sourceElementId && element.id !== targetElementId)
    .map((element) => inflateBox(getElementBox(element, measurer), 4));
  for (let index = 1; index < routePoints.length; index += 1) {
    if (obstacles.some((box) => segmentIntersectsBox(routePoints[index - 1], routePoints[index], box))) return true;
  }
  return false;
}

function inflateBox(box: ElementBox, padding: number): ElementBox {
  return {
    x: box.x - padding,
    y: box.y - padding,
    width: box.width + padding * 2,
    height: box.height + padding * 2,
  };
}

function segmentIntersectsBox(start: Point, end: Point, box: ElementBox): boolean {
  if (start.x === end.x) {
    const x = start.x;
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    return x >= box.x && x <= box.x + box.width && maxY >= box.y && minY <= box.y + box.height;
  }
  if (start.y === end.y) {
    const y = start.y;
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    return y >= box.y && y <= box.y + box.height && maxX >= box.x && minX <= box.x + box.width;
  }
  return false;
}

function routeLength(points: Point[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += distance(points[index - 1], points[index]);
  }
  return length;
}

function dedupeAdjacentPoints(points: Point[]): Point[] {
  return points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
}

function midpoint(start: Point, end: Point): Point {
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
}
