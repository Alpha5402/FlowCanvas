import { describe, expect, it } from 'vitest';
import type { Connection, FlowElement } from '../types/flow';
import { cloneSnapshot, isSelected, toggleSelection } from './state';

const element: FlowElement = {
  id: 'element-a',
  x: 0,
  y: 0,
  width: 120,
  height: 64,
  sizeMode: 'fixed',
  shape: 'rect',
  text: 'Node',
  padding: 12,
  textAlign: 'center',
  borderRadius: 0,
  backgroundColor: '#ffffff',
  borderColor: '#111111',
  borderWidth: 1,
};

const connection: Connection = {
  id: 'connection-a',
  source: { elementId: 'element-a', side: 'right' },
  target: { elementId: 'element-b', side: 'left' },
  lineType: 'solid',
  lineWidth: 1,
  dashLength: 10,
  dashGap: 8,
  arrow: 'end',
  text: '',
  textPosition: 'middle',
};

describe('state', () => {
  it('toggles multi-selection back to a single item and then empty', () => {
    const multi = toggleSelection({ type: 'element', id: 'element-a' }, { type: 'connection', id: 'connection-a' });
    const single = toggleSelection(multi, { type: 'element', id: 'element-a' });
    const empty = toggleSelection(single, { type: 'connection', id: 'connection-a' });

    expect(multi?.type).toBe('multi');
    expect(isSelected(single, 'connection', 'connection-a')).toBe(true);
    expect(single).toEqual({ type: 'connection', id: 'connection-a' });
    expect(empty).toBeNull();
  });

  it('deep-clones connection endpoints and multi-selection items in snapshots', () => {
    const snapshot = {
      elements: [element],
      connections: [connection],
      selection: {
        type: 'multi' as const,
        items: [
          { type: 'element' as const, id: 'element-a' },
          { type: 'connection' as const, id: 'connection-a' },
        ],
      },
    };
    const cloned = cloneSnapshot(snapshot);

    cloned.connections[0].source.elementId = 'changed';
    if (cloned.selection?.type === 'multi') {
      cloned.selection.items[0].id = 'changed';
    }

    expect(snapshot.connections[0].source.elementId).toBe('element-a');
    expect(snapshot.selection.items[0].id).toBe('element-a');
  });
});
