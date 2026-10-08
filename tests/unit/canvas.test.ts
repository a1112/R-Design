import { describe, expect, it } from 'vitest';
import { fitMatrix, inverse, transform, type Matrix } from '../../packages/canvas-core/src/index';

describe('canvas source coordinates', () => {
  it('keeps a source point under zoom, translation and 90 degree rotation', () => {
    // Surface -> view: rotate clockwise 90°, scale 2 and translate (600, 80).
    const view: Matrix = [0, 2, -2, 0, 600, 80];
    const sourcePoint = { x: 120, y: 45 };
    expect(transform(view, sourcePoint)).toEqual({ x: 510, y: 320 });
    expect(transform(inverse(view), { x: 510, y: 320 })).toEqual(sourcePoint);
  });
  it.each([0.5, 1, 1.75, 3])('maps hit coordinates back to the original runtime at zoom %s', zoom => {
    const source = { width: 1200, height: 820 };
    const view = fitMatrix(source, { x: 37, y: 83, w: 660, h: 480 }, zoom);
    for (const point of [{ x: 0, y: 0 }, { x: 1200, y: 820 }, { x: 960.5, y: 421.75 }]) {
      const roundtrip = transform(inverse(view), transform(view, point));
      expect(roundtrip.x).toBeCloseTo(point.x, 9);
      expect(roundtrip.y).toBeCloseTo(point.y, 9);
    }
  });
  it('centers a wide source without stretching its aspect ratio', () => {
    const view = fitMatrix({ width: 1200, height: 800 }, { x: 20, y: 10, w: 600, h: 600 });
    expect(transform(view, { x: 0, y: 0 })).toEqual({ x: 20, y: 110 });
    expect(transform(view, { x: 1200, y: 800 })).toEqual({ x: 620, y: 510 });
  });
  it('refuses a noninvertible view instead of assigning a misleading hit target', () => {
    expect(() => inverse([0, 0, 0, 0, 300, 50])).toThrow('Non-invertible');
    expect(() => fitMatrix({ width: 0, height: 820 }, { x: 0, y: 0, w: 500, h: 500 })).toThrow('Invalid');
  });
});
