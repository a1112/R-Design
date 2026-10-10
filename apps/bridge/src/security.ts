import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { DomainError } from '../../../packages/document-core/src/index.js';
export function validLocalOrigin(origin:string|undefined,host:string|undefined,port:number) {
  const hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`,`[::1]:${port}`]);if(!host||!hosts.has(host.toLowerCase()))return false;
  if(!origin)return true;try {const url=new URL(origin);return url.protocol==='http:'&&hosts.has(url.host.toLowerCase())&&url.pathname==='/';}catch{return false;}
}
export interface NetworkPolicy {port:number;publicOrigin?:string;tls?:boolean}
export function isLoopback(address:string|undefined) {return !!address&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address);}
export function allowedRequest(origin:string|undefined,host:string|undefined,address:string|undefined,encrypted:boolean,policy:NetworkPolicy) {
  const localOrigin=policy.tls&&origin?.startsWith('https:')?origin.replace(/^https:/,'http:'):origin;
  if(isLoopback(address)&&validLocalOrigin(localOrigin,host,policy.port)&&(!policy.tls||encrypted))return true;
  if(!policy.tls||!encrypted||!policy.publicOrigin)return false;
  try {const expected=new URL(policy.publicOrigin);if(expected.protocol!=='https:'||host!==expected.host)return false;return !origin||origin===expected.origin;}catch{return false;}
}
export function requireBridgeRequest(request:Request,policy:NetworkPolicy) {
  if(!allowedRequest(request.headers.origin,request.headers.host,request.socket.remoteAddress,Boolean((request.socket as any).encrypted),policy))throw new DomainError('ORIGIN_FORBIDDEN','请求来源或传输不在授权范围内',403);
}
export function requireLocalBootstrap(request:Request,port:number) {
  const ownHost=[`127.0.0.1:${port}`,`localhost:${port}`,`[::1]:${port}`].includes(request.headers.host??'');
  if(!isLoopback(request.socket.remoteAddress)||!ownHost)throw new DomainError('REMOTE_BOOTSTRAP_FORBIDDEN','远程设备必须使用一次性配对码',403);
}
export interface Device {id:string;name:string;expiresAt:string;hash:string;projectId?:string}
export class Authenticator {
  readonly token=randomBytes(32).toString('hex');private localHash=this.hash(this.token);private devices:Device[]=[];private pairing:{code:string;expiresAt:number;projectId?:string}|null=null;private attempts:number[]=[];
  hash(token:string) {return createHash('sha256').update(token).digest('hex');}
  publicDevices(projectId?:string) {return this.devices.filter(d=>Date.parse(d.expiresAt)>Date.now()&&(!projectId||d.projectId===projectId)).map(({hash,...rest})=>rest);}
  identify(token:unknown) {if(typeof token!=='string'||token.length<32||token.length>128)throw new DomainError('AUTH_REQUIRED','需要有效的会话令牌',401);const hash=this.hash(token);if(timingSafeEqual(Buffer.from(hash),Buffer.from(this.localHash)))return 'desktop';const device=this.devices.find(d=>d.hash===hash&&Date.parse(d.expiresAt)>Date.now());if(!device)throw new DomainError('AUTH_REQUIRED','令牌已失效或被撤销',401);return device.id;}
  authenticate(request:Request) {const header=request.headers.authorization;return this.identify(header?.startsWith('Bearer ')?header.slice(7):undefined);}
  scope(owner:string){return owner==='desktop'?undefined:this.devices.find(d=>d.id===owner&&Date.parse(d.expiresAt)>Date.now())?.projectId;}
  assertProject(owner:string,projectId:string){if(owner!=='desktop'&&this.scope(owner)!==projectId)throw new DomainError('PROJECT_SCOPE','配对设备仅能访问获准工程；当前桌面已切换到其他工程',403);}
  code(projectId?:string) {const code=String(randomBytes(4).readUInt32BE()%1000000).padStart(6,'0');this.pairing={code,expiresAt:Date.now()+90000,projectId};return {code,expiresAt:new Date(this.pairing.expiresAt).toISOString()};}
  redeem(code:unknown,name:unknown) {const now=Date.now();this.attempts=this.attempts.filter(t=>now-t<60000);if(this.attempts.length>=8)throw new DomainError('PAIRING_RATE_LIMIT','配对尝试过多，请稍后重试',429,true);this.attempts.push(now);if(!this.pairing||this.pairing.expiresAt<now||typeof code!=='string'||!/^\d{6}$/.test(code)||code!==this.pairing.code)throw new DomainError('PAIRING_INVALID','配对码错误或已过期',403);if(typeof name!=='string'||!name.trim()||name.length>80)throw new DomainError('PAIRING_NAME','设备名称必须为 1–80 个字符',400);const projectId=this.pairing.projectId;this.pairing=null;const token=randomBytes(32).toString('hex');const device:Device={projectId,id:'device_'+randomBytes(8).toString('hex'),name,expiresAt:new Date(now+8*60*60*1000).toISOString(),hash:this.hash(token)};this.devices.push(device);return {token,deviceId:device.id,projectId};}
  revoke(id:string) {if(!this.devices.some(d=>d.id===id))throw new DomainError('DEVICE_NOT_FOUND','设备不存在',404);this.devices=this.devices.filter(d=>d.id!==id);return {revoked:true,deviceId:id};}
}
