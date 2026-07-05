import type { Connection, FlowElement, Point } from '../types/flow';
import { distanceToConnection, getConnectionPath, pointInElement, type Measurer } from './geometry';

export function hitTestElement(point: Point, elements: FlowElement[], measurer?: Measurer): FlowElement | null {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    if (pointInElement(point, elements[index], measurer)) return elements[index];
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
    if (path && distanceToConnection(point, path) <= 8) return connections[index];
  }
  return null;
}
