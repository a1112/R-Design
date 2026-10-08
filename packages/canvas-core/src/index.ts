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
