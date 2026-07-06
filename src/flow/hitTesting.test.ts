import { describe, expect, it } from 'vitest';
import type { Connection, FlowElement } from '../types/flow';
import { getConnectionLabelBox, getConnectionPath } from './geometry';
import { getConnectionHitDistance, hitTestConnection } from './hitTesting';

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
  backgroundColor: '#ffffff',
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
});
