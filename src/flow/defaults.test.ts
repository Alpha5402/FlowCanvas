import { describe, expect, it } from 'vitest';
import { createConnection, createElement } from './defaults';

describe('defaults', () => {
  it('creates plain rectangular elements by default', () => {
    const element = createElement(10, 20);

    expect(element).toEqual(
      expect.objectContaining({
        x: 10,
        y: 20,
        shape: 'rect',
        borderRadius: 0,
        backgroundColor: 'transparent',
        borderColor: '#111111',
        borderWidth: 1,
      }),
    );
  });

  it('creates unlabeled one-pixel connections by default', () => {
    const connection = createConnection('source', 'target', 'bottom', 'left');

    expect(connection).toEqual(
      expect.objectContaining({
        source: { elementId: 'source', side: 'bottom' },
        target: { elementId: 'target', side: 'left' },
        lineWidth: 1,
        text: '',
      }),
    );
  });
});
