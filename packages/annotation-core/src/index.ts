import type { Annotation, Stroke, RuntimeFrame } from '../../protocol/src/index';
export interface PendingAnnotation { annotation: Annotation; operationId: string; frozenFrame?: RuntimeFrame }
export const QUEUE_KEY='rdesign.annotation-outbox.v1';
export function readOutbox(storage: Pick<Storage,'getItem'>): PendingAnnotation[] {
  try { const raw=JSON.parse(storage.getItem(QUEUE_KEY)||'[]'); return Array.isArray(raw)?raw.filter(v=>v?.annotation?.id&&v?.operationId):[]; } catch {return [];}
}
export function putOutbox(storage: Pick<Storage,'getItem'|'setItem'>, item: PendingAnnotation) {
  const queue=readOutbox(storage).filter(v=>v.operationId!==item.operationId);
  queue.push(item); storage.setItem(QUEUE_KEY,JSON.stringify(queue)); return queue;
}
export function acknowledge(storage: Pick<Storage,'getItem'|'setItem'>, operationId:string) {
  const next=readOutbox(storage).filter(v=>v.operationId!==operationId); storage.setItem(QUEUE_KEY,JSON.stringify(next)); return next;
}
export function preserveConflict(local: Annotation, remote: Annotation): Annotation[] {
  if(JSON.stringify(local)===JSON.stringify(remote)) return [remote];
  return [remote,{...local,id:local.id+'-conflict-'+local.revision, status:'comment',text:local.text+'\n[离线副本：请重新确认意图]'}];
}
export function validateStroke(stroke: Stroke) {
  return stroke.points.length>0 && stroke.points.every(p=>[p.x,p.y,p.pressure,p.time].every(Number.isFinite)&&p.pressure>=0&&p.pressure<=1);
}
