import { describe, expect, it } from 'vitest';
import type { Connection, FlowElement } from '../types/flow';
import { getArrowAngle, getConnectionPath, measureFitContent, snapElement } from './geometry';

const baseElement: FlowElement = {
  id: 'a',
  x: 10,
  y: 20,
  width: 120,
  height: 60,
  sizeMode: 'fixed',
  shape: 'rounded-rect',
  text: 'Node',
  padding: 10,
  textAlign: 'center',
  borderRadius: 8,
  backgroundColor: '#ffffff',
  borderColor: '#000000',
  borderWidth: 2,
};

const measurer = {
  measureText: (text: string) => ({ width: text.length * 8 }),
};

describe('geometry', () => {
  it('measures fit-content elements from text, padding, and border', () => {
    const size = measureFitContent(
      {
        ...baseElement,
        sizeMode: 'fit-content',
        text: 'Long text',
        padding: 12,
        borderWidth: 3,
      },
      measurer,
    );

    expect(size.width).toBe(102);
    expect(size.height).toBe(50);
  });

  it('keeps fit-content circles square', () => {
    const size = measureFitContent(
      {
        ...baseElement,
        shape: 'circle',
        sizeMode: 'fit-content',
        text: 'Circle label',
      },
      measurer,
    );

    expect(size.width).toBe(size.height);
  });

  it('snaps moving element edges and returns alignment guides', () => {
    const moving = { ...baseElement, id: 'moving', x: 0, y: 0 };
    const target = { ...baseElement, id: 'target', x: 200, y: 160 };

    const result = snapElement(moving, [moving, target], 205, 60, measurer);

    expect(result.x).toBe(200);
    expect(result.guides.some((guide) => guide.orientation === 'vertical' && guide.position === 200)).toBe(true);
  });

  it('uses a straight path when centers are nearly horizontal', () => {
    const elements = [
      { ...baseElement, id: 'a', x: 0, y: 0 },
      { ...baseElement, id: 'b', x: 260, y: 3 },
    ];
    const connection: Connection = {
      id: 'c',
      sourceElementId: 'a',
      targetElementId: 'b',
      lineType: 'solid',
      dashLength: 8,
      dashGap: 6,
      arrow: 'end',
      text: '',
      textPosition: 'middle',
    };

    expect(getConnectionPath(connection, elements, measurer)?.isStraight).toBe(true);
  });

  it('uses a quadratic path when centers are diagonal', () => {
    const elements = [
      { ...baseElement, id: 'a', x: 0, y: 0 },
      { ...baseElement, id: 'b', x: 260, y: 160 },
    ];
    const connection: Connection = {
      id: 'c',
      sourceElementId: 'a',
      targetElementId: 'b',
      lineType: 'solid',
      dashLength: 8,
      dashGap: 6,
      arrow: 'end',
      text: '',
      textPosition: 'middle',
    };

    const path = getConnectionPath(connection, elements, measurer);

    expect(path?.isStraight).toBe(false);
    expect(path?.control).not.toBeNull();
  });

  it('calculates opposite arrow angles for start and end on straight paths', () => {
    const path = {
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      control: null,
      isStraight: true,
      textPoint: { x: 50, y: 0 },
      textAngle: 0,
    };

    expect(getArrowAngle(path, 'end')).toBeCloseTo(0);
    expect(getArrowAngle(path, 'start')).toBeCloseTo(Math.PI);
  });
});
