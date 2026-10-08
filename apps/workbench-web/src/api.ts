import type { BridgeError, WriteEnvelope } from '../../../packages/protocol/src/index';
let token=sessionStorage.getItem('rd-token')||'';
const params=new URLSearchParams(location.search);
if(params.get('token')) { token=params.get('token')!; sessionStorage.setItem('rd-token',token); params.delete('token'); history.replaceState(null,'',location.pathname+(params.size?'?'+params:'')); }
export function getToken(){return token;}
export function setToken(value:string){token=value;sessionStorage.setItem('rd-token',value);}
export class ApiError extends Error { constructor(message:string,public code:string,public status:number){super(message);} }
export async function api<T>(path:string,body?:unknown):Promise<T> {
  const res=await fetch('/api'+path,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const value=await res.json();
  if(!res.ok){const err=(value as BridgeError).error;throw new ApiError(err?.message||'请求失败',err?.code||'REQUEST_FAILED',res.status);}
  return value as T;
}
export async function bootstrap(){ if(token)return; const r=await api<{token:string}>('/bootstrap');setToken(r.token); }
export function envelope(project:{id:string;revision:number},operationId:string=crypto.randomUUID()):WriteEnvelope{return {projectId:project.id,expectedRevision:project.revision,operationId};}
