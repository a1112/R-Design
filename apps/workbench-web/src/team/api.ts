export class TeamApiError extends Error {
  constructor(message:string,public code:string,public status:number){super(message);}
}
const configuredBase=(import.meta as ImportMeta & {env?:{BASE_URL?:string}}).env?.BASE_URL||'/';
export const teamBase=configuredBase.replace(/\/$/,'');
const errors:Record<string,string>={INVALID_CREDENTIALS:'邮箱或密码不正确，请检查后重试。',UNAUTHENTICATED:'登录已过期，请重新登录。',LOGIN_RATE_LIMIT:'登录尝试过多，请稍后重试。',EMAIL_EXISTS:'此邮箱已开通团队账号。',FORBIDDEN:'你的项目角色没有执行此操作的权限。',SELF_REVIEW_FORBIDDEN:'创建者与提交人不能审批自己的设计，请交由项目审批人处理。',HASH_CONFLICT:'设计版本已更新，请刷新后重新检查。',STALE_VERSION:'当前设计已不是最新版本，请打开最新版本后继续。',STATE_CONFLICT:'版本状态已改变，请刷新后检查最新状态。',LAST_OWNER:'项目必须至少保留一位负责人。',OPERATION_COLLISION:'操作身份与内容发生冲突，请刷新并检查操作结果。',PAYLOAD_TOO_LARGE:'上传内容超过服务限制，请减小设计图片或证据文件。',INTERNAL_ERROR:'服务暂时无法完成操作，请稍后重试。'};
export async function teamApi<T>(path:string,body?:unknown):Promise<T>{
  let response:Response;
  try{response=await fetch(`${teamBase}/api/team${path}`,{method:body===undefined?'GET':'POST',credentials:'same-origin',signal:AbortSignal.timeout(30000),headers:body===undefined?{Accept:'application/json'}:{Accept:'application/json','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});}
  catch{throw new TeamApiError('暂时无法连接服务。请检查网络后重试；未确认的操作将保留相同操作身份。','NETWORK_ERROR',0);}
  const value=await response.json().catch(()=>null);
  if(!response.ok){const code=value?.error?.code||'REQUEST_FAILED';throw new TeamApiError(errors[code]||value?.error?.message||'请求未完成，请重试。',code,response.status);}
  if(value===null)throw new TeamApiError('服务返回了无法读取的结果。','INVALID_RESPONSE',response.status);
  return value as T;
}
/** One form keeps this identity after an uncertain response and clears it only on success. */
export function operationId(){return crypto.randomUUID();}
