import { DomainError } from '../../../packages/document-core/src/index.js';

/** One lane owns context mutation: requests, captures and project activation cannot overlap. */
export class ProjectExecutionGate {
  private queue:Promise<unknown>=Promise.resolve();
  run<T>(operation:()=>Promise<T>|T):Promise<T> {const result=this.queue.then(operation);this.queue=result.catch(()=>{});return result;}
}
export function assertAnnotationProject(annotation:{projectId?:unknown}|undefined,projectId:string) {
  if(annotation?.projectId!==projectId)throw new DomainError('PROJECT_MISMATCH','批注属于另一工程，已保留原始离线内容而未写入当前工程',409);
}
