import { describe, expect, it } from 'vitest';
import { fitMatrix, inverse, transform, worldToScreen, screenToWorld, panCamera, zoomCameraAt, fitCamera, MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM, type Matrix } from '../../packages/canvas-core/src/index';

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


describe('infinite canvas navigation', () => {
  it('changes scale around the cursor while retaining the same document point', () => {
    const camera = { x: 140, y: -240, zoom: 0.5 };
    const cursor = { x: 320, y: 180 };
    const documentPoint = { x: 360, y: 840 };
    expect(screenToWorld(camera, cursor)).toEqual(documentPoint);
    const zoomed = zoomCameraAt(camera, cursor, 2);
    expect(zoomed).toEqual({ x: -400, y: -1500, zoom: 2 });
    expect(worldToScreen(zoomed, documentPoint)).toEqual(cursor);
    expect(camera).toEqual({ x: 140, y: -240, zoom: 0.5 });
  });
  it('retains the cursor anchor when zoom reaches either supported scale limit', () => {
    const camera = { x: -720, y: 360, zoom: 1.25 };
    const cursor = { x: 210, y: 185 };
    const point = screenToWorld(camera, cursor);
    for (const [request, scale] of [[1000, MAX_CAMERA_ZOOM], [0.00001, MIN_CAMERA_ZOOM]]) {
      const next = zoomCameraAt(camera, cursor, request);
      expect(next.zoom).toBe(scale);
      const actual = worldToScreen(next, point);
      expect(actual.x).toBeCloseTo(cursor.x, 9);
      expect(actual.y).toBeCloseTo(cursor.y, 9);
    }
  });
  it('pans past any artboard extent without clamping or changing scale', () => {
    const camera = panCamera({ x: 0, y: 0, zoom: 2 }, { x: -100_000_000, y: 100_000_000 });
    expect(camera).toEqual({ x: -100_000_000, y: 100_000_000, zoom: 2 });
    const point = { x: 1200, y: 820 };
    expect(screenToWorld(camera, worldToScreen(camera, point))).toEqual(point);
  });
  it('fits the combined world bounds of multiple boards including nonzero origins', () => {
    const bounds = { x: 250, y: -120, w: 2590, h: 950 };
    const camera = fitCamera(bounds, { width: 900, height: 700 }, 40);
    const topLeft = worldToScreen(camera, { x: bounds.x, y: bounds.y });
    const bottomRight = worldToScreen(camera, { x: bounds.x + bounds.w, y: bounds.y + bounds.h });
    expect(topLeft.x).toBeGreaterThanOrEqual(40 - 1e-8);
    expect(topLeft.y).toBeGreaterThanOrEqual(40 - 1e-8);
    expect(bottomRight.x).toBeLessThanOrEqual(860 + 1e-8);
    expect(bottomRight.y).toBeLessThanOrEqual(660 + 1e-8);
    const center = worldToScreen(camera, { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 });
    expect(center.x).toBeCloseTo(450, 9);
    expect(center.y).toBeCloseTo(350, 9);
  });
  it('does not enlarge a small board beyond its actual pixel scale when fitting', () => {
    expect(fitCamera({ x: 0, y: 0, w: 320, h: 240 }, { width: 1200, height: 900 })).toEqual({ x: 440, y: 330, zoom: 1 });
  });
  it('rejects invalid navigation data instead of emitting unusable hit coordinates', () => {
    expect(() => screenToWorld({ x: 0, y: 0, zoom: 0 }, { x: 1, y: 1 })).toThrow('Invalid');
    expect(() => zoomCameraAt({ x: 0, y: 0, zoom: 1 }, { x: NaN, y: 5 }, 2)).toThrow('Invalid');
    expect(() => panCamera({ x: 0, y: 0, zoom: 1 }, { x: Infinity, y: 0 })).toThrow('Invalid');
    expect(() => fitCamera({ x: 0, y: 0, w: 0, h: 500 }, { width: 800, height: 600 })).toThrow('Invalid');
  });
});
