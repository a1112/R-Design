import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Link2, Loader2, RefreshCw } from 'lucide-react';
import type { BridgeState, ProjectSummary, WorkspaceCatalog } from '../../../packages/protocol/src/index';
import { api, ApiError, bootstrap, getToken, setToken } from './api';
import { migrateLegacyDrafts } from './projectStorage';
import { ProjectHome } from './ProjectHome';
import { Workbench } from './Workbench';

type View = { type:'home' } | { type:'editor'; id:string } | { type:'legacy-editor' };
function readView():View {
  const match=/^\/project\/(project_[a-zA-Z0-9_-]+)\/?$/.exec(location.pathname);
  if(match)return {type:'editor',id:match[1]};
  return location.pathname==='/editor'?{type:'legacy-editor'}:{type:'home'};
}
export function App(){
  const [view,setView]=useState<View>(readView);
  const [catalog,setCatalog]=useState<WorkspaceCatalog|null>(null);
  const [loading,setLoading]=useState(true);
  const [authRequired,setAuthRequired]=useState(false);
  const [error,setError]=useState('');
  const [opening,setOpening]=useState('');
  const [pairCode,setPairCode]=useState('');
  const [deviceName,setDeviceName]=useState('iPad 设计工作台');
  const mounted=useRef(true);const viewRef=useRef(view);viewRef.current=view;
  const openPromise=useRef<Promise<void>|null>(null);

  function navigate(next:View,replace=false){
    const target=next.type==='editor'?`/project/${next.id}`:next.type==='legacy-editor'?'/editor':'/';
    if(replace)history.replaceState(null,'',target);else history.pushState(null,'',target);
    setView(next);
  }
  async function refreshCatalog(){
    const next=await api<WorkspaceCatalog>('/projects');
    const legacy=next.projects.find(p=>p.kind==='linked');
    if(legacy)migrateLegacyDrafts(legacy.id);
    if(mounted.current)setCatalog(next);
    return next;
  }
  async function authorize(){
    await bootstrap();
    try{return await refreshCatalog();}
    catch(e){if(e instanceof ApiError&&e.status===401&&['localhost','127.0.0.1','[::1]'].includes(location.hostname)){setToken('');await bootstrap();return refreshCatalog();}throw e;}
  }
  async function openProject(project:ProjectSummary,replace=false){
    if(openPromise.current)return openPromise.current;
    const run=(async()=>{
      setOpening(project.id);setError('');
      try{
        const next=await refreshCatalog();
        const result=await api<BridgeState>(`/projects/${encodeURIComponent(project.id)}/open`,{operationId:crypto.randomUUID(),expectedRevision:next.revision});
        if(result.project.id!==project.id)throw new Error('工程身份与打开结果不一致');
        await refreshCatalog();
        if(mounted.current)navigate({type:'editor',id:project.id},replace);
      }finally{setOpening('');}
    })();openPromise.current=run;
    try{await run;}finally{openPromise.current=null;}
  }
  async function ensureRoute(next:View,current:WorkspaceCatalog){
    if(next.type==='home')return;
    const id=next.type==='legacy-editor'?current.activeProjectId:next.id;
    const project=current.projects.find(p=>p.id===id&&!p.archived);
    if(!project)throw new Error('工程不存在、已归档或当前设备无权访问');
    if(current.activeProjectId!==id){await openProject(project,true);return;}
    if(next.type==='legacy-editor')navigate({type:'editor',id:project.id},true);
  }
  useEffect(()=>{
    mounted.current=true;let disposed=false;
    const init=async()=>{
      try{const next=await authorize();if(!disposed){setAuthRequired(false);await ensureRoute(readView(),next);}}
      catch(e){if(disposed)return;if(e instanceof ApiError&&e.status===401||!getToken()){setAuthRequired(true);}else{setError(e instanceof Error?e.message:String(e));navigate({type:'home'},true);}}
      finally{if(!disposed)setLoading(false);}
    };
    void init();
    const pop=()=>{const next=readView();setView(next);void refreshCatalog().then(c=>ensureRoute(next,c)).catch(e=>{setError(e.message);navigate({type:'home'},true);});};
    window.addEventListener('popstate',pop);
    return()=>{disposed=true;mounted.current=false;window.removeEventListener('popstate',pop);};
  },[]);
  async function redeem(){
    setLoading(true);setError('');
    try{const result=await api<{token:string}>('/pairing/redeem',{code:pairCode,name:deviceName});setToken(result.token);await refreshCatalog();setAuthRequired(false);navigate({type:'home'},true);}
    catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setLoading(false);}
  }
  function home(reason?:string){if(reason)setError(reason);navigate({type:'home'});void refreshCatalog().catch(e=>setError(e.message));}
  if(authRequired)return <div className="auth-screen"><div className="auth-card"><div className="brand"><span className="brand-mark"><span/><span/><span/></span><strong>R-Design</strong></div><div className="auth-icon"><Link2 size={30}/></div><h1>连接设计工作空间</h1><p>在电脑上创建一次性配对码，让这台设备打开获准的工程。</p><label>设备名称<input value={deviceName} onChange={e=>setDeviceName(e.target.value)}/></label><label>配对码<input value={pairCode} onChange={e=>setPairCode(e.target.value)} placeholder="六位一次性配对码" inputMode="numeric"/></label><button className="primary" onClick={()=>void redeem()} disabled={loading||!pairCode.trim()}><Link2 size={15}/>配对工作空间</button><small>工程授权由电脑端控制，可随时撤销。</small>{error&&<div className="inline-error" role="alert">{error}</div>}</div></div>;
  if(loading||!catalog)return <div className="workspace-loading"><div className="brand"><span className="brand-mark"><span/><span/><span/></span><strong>R-Design</strong></div>{error?<><p role="alert">{error}</p><button className="secondary" onClick={()=>location.reload()}><RefreshCw size={15}/>重新连接工作空间</button></>:<><Loader2 className="spin" size={22}/><p>正在读取工程目录…</p></>}</div>;
  if(view.type==='editor')return <Workbench key={view.id} projectId={view.id} onHome={()=>home()} onProjectUnavailable={reason=>{const current=viewRef.current;if(current.type==='editor'&&current.id===view.id)home(reason);}}/>;
  if(view.type==='legacy-editor')return <div className="workspace-loading"><Loader2 className="spin"/><p>正在打开当前工程…</p></div>;
  return <><ProjectHome catalog={catalog} onRefresh={refreshCatalog} onOpen={openProject} busyProjectId={opening||undefined}/>{error&&<div className="workspace-banner" role="alert"><FolderOpen size={16}/><span>{error}</span><button onClick={()=>setError('')} aria-label="关闭提示">×</button></div>}</>;
}
