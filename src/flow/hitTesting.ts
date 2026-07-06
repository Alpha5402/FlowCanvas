import type { Anchor, AnchorSide, Connection, ConnectionEnd, FlowElement, Point, ResizeHandle } from '../types/flow';
import {
  distance,
  distanceToConnection,
  getAnchorHandlePoint,
  getConnectionLabelBox,
  getConnectionPath,
  getElementAnchors,
  getElementBox,
  getResizeHandles,
  pointInElement,
  type Measurer,
} from './geometry';

const ANCHOR_HIT_RADIUS = 10;
const EDGE_HIT_DISTANCE = 8;
const RESIZE_HIT_RADIUS = 12;
const CONNECTION_HIT_PADDING = 7.5;

export type CanvasObjectHit =
  | { type: 'element'; item: FlowElement }
  | { type: 'connection'; item: Connection };

export function hitTestElement(point: Point, elements: FlowElement[], measurer?: Measurer): FlowElement | null {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    if (pointInElement(point, elements[index], measurer)) return elements[index];
  }
  return null;
}

export function hitTestCanvasObject(
  point: Point,
  elements: FlowElement[],
  connections: Connection[],
  measurer?: Measurer,
): CanvasObjectHit | null {
  const element = hitTestElement(point, elements, measurer);
  if (element) return { type: 'element', item: element };
  const connection = hitTestConnection(point, connections, elements, measurer);
  if (connection) return { type: 'connection', item: connection };
  return null;
}

export function hitTestAnchorHandle(point: Point, elements: FlowElement[], measurer?: Measurer): Anchor | null {
  for (let elementIndex = elements.length - 1; elementIndex >= 0; elementIndex -= 1) {
    for (const anchor of getElementAnchors(elements[elementIndex], measurer)) {
      if (distance(point, getAnchorHandlePoint(anchor)) <= ANCHOR_HIT_RADIUS) return anchor;
    }
  }
  return null;
}

export function hitTestElementAnchorOrEdge(
  point: Point,
  elements: FlowElement[],
  excludeElementId?: string,
  measurer?: Measurer,
): Anchor | null {
  let closestAnchor: { anchor: Anchor; distance: number } | null = null;

  for (let elementIndex = elements.length - 1; elementIndex >= 0; elementIndex -= 1) {
    const element = elements[elementIndex];
    if (element.id === excludeElementId) continue;

    for (const anchor of getElementAnchors(element, measurer)) {
      const anchorDistance = distance(point, anchor);
      if (anchorDistance <= ANCHOR_HIT_RADIUS && (!closestAnchor || anchorDistance < closestAnchor.distance)) {
        closestAnchor = { anchor, distance: anchorDistance };
      }
    }
  }

  if (closestAnchor) return closestAnchor.anchor;

  for (let elementIndex = elements.length - 1; elementIndex >= 0; elementIndex -= 1) {
    const element = elements[elementIndex];
    if (element.id === excludeElementId) continue;
    const side = closestElementSide(point, element, measurer);
    if (side) {
      return getElementAnchors(element, measurer).find((anchor) => anchor.side === side) ?? null;
    }
  }

  return null;
}

export function hitTestResizeHandle(
  point: Point,
  element: FlowElement | null,
  measurer?: Measurer,
): ResizeHandle | null {
  if (!element || element.sizeMode !== 'fixed') return null;
  for (const { handle, point: handlePoint } of getResizeHandles(element, measurer)) {
    if (distance(point, handlePoint) <= RESIZE_HIT_RADIUS) return handle;
  }
  return null;
}

export function hitTestResizeHandleOnElements(
  point: Point,
  elements: FlowElement[],
  measurer?: Measurer,
): { element: FlowElement; handle: ResizeHandle } | null {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const handle = hitTestResizeHandle(point, elements[index], measurer);
    if (handle) return { element: elements[index], handle };
  }
  return null;
}

export function hitTestConnection(
  point: Point,
  connections: Connection[],
  elements: FlowElement[],
  measurer?: Measurer,
): Connection | null {
  for (let index = connections.length - 1; index >= 0; index -= 1) {
    const path = getConnectionPath(connections[index], elements, measurer);
    if (!path) continue;
    const labelBox = getConnectionLabelBox(connections[index], path, measurer);
    if (labelBox && pointInBox(point, labelBox)) return connections[index];
    if (distanceToConnection(point, path) <= getConnectionHitDistance(connections[index])) return connections[index];
  }
  return null;
}

export function inferConnectionDragEnd(
  point: Point,
  connection: Connection,
  elements: FlowElement[],
  measurer?: Measurer,
): ConnectionEnd | null {
  const path = getConnectionPath(connection, elements, measurer);
  if (!path) return null;
  const sourceDistance = distance(point, path.sourceAnchor);
  const targetDistance = distance(point, path.targetAnchor);
  return sourceDistance <= targetDistance ? 'source' : 'target';
}

export function getConnectionHitDistance(connection: Pick<Connection, 'lineWidth'>): number {
  return Math.max(8, CONNECTION_HIT_PADDING + Math.max(1, connection.lineWidth ?? 1) / 2);
}

function closestElementSide(point: Point, element: FlowElement, measurer?: Measurer): AnchorSide | null {
  const box = getElementBox(element, measurer);
  const withinVertical = point.y >= box.y - EDGE_HIT_DISTANCE && point.y <= box.y + box.height + EDGE_HIT_DISTANCE;
  const withinHorizontal = point.x >= box.x - EDGE_HIT_DISTANCE && point.x <= box.x + box.width + EDGE_HIT_DISTANCE;
  const candidates: Array<{ side: AnchorSide; distance: number }> = [];

  if (withinVertical) {
    candidates.push({ side: 'left', distance: Math.abs(point.x - box.x) });
    candidates.push({ side: 'right', distance: Math.abs(point.x - (box.x + box.width)) });
  }
  if (withinHorizontal) {
    candidates.push({ side: 'top', distance: Math.abs(point.y - box.y) });
    candidates.push({ side: 'bottom', distance: Math.abs(point.y - (box.y + box.height)) });
  }

  const closest = candidates
    .filter((candidate) => candidate.distance <= EDGE_HIT_DISTANCE)
    .sort((a, b) => a.distance - b.distance)[0];

  return closest?.side ?? null;
}

function pointInBox(point: Point, box: { x: number; y: number; width: number; height: number }): boolean {
  return point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
}
