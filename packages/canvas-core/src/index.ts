import type { Bounds, RuntimeVersion, StrokePoint } from '../../protocol/src/index';
export type Matrix = [number, number, number, number, number, number];
export const identity: Matrix = [1,0,0,1,0,0];
export function transform(m: Matrix, p: {x:number;y:number}) { return {x:m[0]*p.x+m[2]*p.y+m[4],y:m[1]*p.x+m[3]*p.y+m[5]}; }
export function inverse(m: Matrix): Matrix {
  const det=m[0]*m[3]-m[1]*m[2];
  if (!Number.isFinite(det)||Math.abs(det)<1e-12) throw new Error('Non-invertible canvas transform');
  return [m[3]/det,-m[1]/det,-m[2]/det,m[0]/det,(m[2]*m[5]-m[3]*m[4])/det,(m[1]*m[4]-m[0]*m[5])/det];
}
export function fitMatrix(surface: {width:number;height:number}, canvas: Bounds, zoom=1): Matrix {
  if(surface.width<=0||surface.height<=0||zoom<=0) throw new Error('Invalid canvas dimensions');
  const scale=Math.min(canvas.w/surface.width,canvas.h/surface.height)*zoom;
  return [scale,0,0,scale,canvas.x+(canvas.w-surface.width*scale)/2,canvas.y+(canvas.h-surface.height*scale)/2];
}
export function strokeBounds(points: StrokePoint[]): Bounds {
  if(!points.length) return {x:0,y:0,w:0,h:0};
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};
}
export function versionOf(v: RuntimeVersion): RuntimeVersion {
  const {runtimeSessionId,epoch,surfaceId,codeRevision,treeRevision,viewportRevision,geometryRevision}=v;
  return {runtimeSessionId,epoch,surfaceId,codeRevision,treeRevision,viewportRevision,geometryRevision};
}

/** The camera transforms document coordinates, never the controlled runtime viewport. */
export interface Camera { x: number; y: number; zoom: number }
export const MIN_CAMERA_ZOOM = 0.05;
export const MAX_CAMERA_ZOOM = 8;
export function worldToScreen(camera: Camera, point: {x:number;y:number}) {
  return { x: camera.x + point.x * camera.zoom, y: camera.y + point.y * camera.zoom };
}
export function screenToWorld(camera: Camera, point: {x:number;y:number}) {
  if (!Number.isFinite(camera.zoom) || camera.zoom <= 0) throw new Error('Invalid camera scale');
  return { x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom };
}
export function panCamera(camera: Camera, delta: {x:number;y:number}): Camera {
  if (![delta.x, delta.y].every(Number.isFinite)) throw new Error('Invalid camera delta');
  return {...camera, x: camera.x + delta.x, y: camera.y + delta.y};
}
export function zoomCameraAt(camera: Camera, point: {x:number;y:number}, requestedZoom: number): Camera {
  if (![point.x, point.y, requestedZoom].every(Number.isFinite)) throw new Error('Invalid zoom anchor');
  const zoom = Math.min(MAX_CAMERA_ZOOM, Math.max(MIN_CAMERA_ZOOM, requestedZoom));
  const world = screenToWorld(camera, point);
  return { x: point.x - world.x * zoom, y: point.y - world.y * zoom, zoom };
}
export function fitCamera(bounds: Bounds, viewport: {width:number;height:number}, padding=48, maxZoom=1): Camera {
  if (![bounds.x,bounds.y,bounds.w,bounds.h,viewport.width,viewport.height,padding,maxZoom].every(Number.isFinite) || bounds.w<=0 || bounds.h<=0 || viewport.width<=0 || viewport.height<=0 || maxZoom<=0) throw new Error('Invalid camera bounds');
  const zoom = Math.max(MIN_CAMERA_ZOOM, Math.min(MAX_CAMERA_ZOOM, maxZoom, Math.max(1,viewport.width-padding*2)/bounds.w, Math.max(1,viewport.height-padding*2)/bounds.h));
  return { x: (viewport.width-bounds.w*zoom)/2-bounds.x*zoom, y: (viewport.height-bounds.h*zoom)/2-bounds.y*zoom, zoom };
}
