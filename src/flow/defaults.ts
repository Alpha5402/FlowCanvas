import type { Connection, FlowElement } from '../types/flow';

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
    shape: 'rounded-rect',
    text: `Step ${elementCounter - 1}`,
    padding: 14,
    textAlign: 'center',
    borderRadius: 14,
    backgroundColor: '#f8fbff',
    borderColor: '#3b82f6',
    borderWidth: 2,
  };
}

export function createConnection(sourceElementId: string, targetElementId: string): Connection {
  return {
    id: `connection-${connectionCounter++}`,
    sourceElementId,
    targetElementId,
    lineType: 'solid',
    dashLength: 10,
    dashGap: 8,
    arrow: 'end',
    text: 'Next',
    textPosition: 'middle',
  };
}
