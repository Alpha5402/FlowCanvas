import type { AnchorSide, Connection, FlowElement } from '../types/flow';

let elementCounter = 1;
let connectionCounter = 1;

export function createElement(x: number, y: number): FlowElement {
  const id = `element-${elementCounter++}`;

  return {
    id,
    x,
    y,
    width: 150,
    height: 72,
    sizeMode: 'fixed',
    shape: 'rect',
    text: `Step ${elementCounter - 1}`,
    padding: 14,
    textAlign: 'center',
    borderRadius: 0,
    backgroundColor: '#ffffff',
    borderColor: '#111111',
    borderWidth: 1,
  };
}

export function createConnection(
  sourceElementId: string,
  targetElementId: string,
  sourceSide: AnchorSide = 'right',
  targetSide: AnchorSide = 'left',
): Connection {
  return {
    id: `connection-${connectionCounter++}`,
    source: { elementId: sourceElementId, side: sourceSide },
    target: { elementId: targetElementId, side: targetSide },
    lineType: 'solid',
    lineWidth: 1,
    dashLength: 10,
    dashGap: 8,
    arrow: 'end',
    text: '',
    textPosition: 'middle',
  };
}
