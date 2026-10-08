import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Activity, ArrowDownToLine, ArrowLeftRight, ArrowUpRight, Box, Check, CheckCircle2, ChevronDown, ChevronRight, Circle, Code2, Copy, FileImage, FileText, FolderOpen, GitBranch, Hand, History, Layers, Link2, Loader2, Maximize2, MessageSquare, Monitor, MousePointer2, PanelLeftClose, Pencil, Play, Plus, Radio, RefreshCw, ScanLine, Search, Settings2, ShieldCheck, Smartphone, Sparkles, Square, Undo2, Wifi, WifiOff, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { Annotation, Asset, BridgeState, ChangeSet, Mode, ObservedNode, Project, RuntimeFrame, ServerEvent, Stroke } from '../../../packages/protocol/src/index';
import { versionOf, strokeBounds } from '../../../packages/canvas-core/src/index';
import { acknowledge, putOutbox, readOutbox, type PendingAnnotation } from '../../../packages/annotation-core/src/index';
import { api, ApiError, bootstrap, envelope, getToken, setToken } from './api';

type Tab='pages'|'layers'|'assets';
type Inspector='properties'|'annotations'|'tasks';
const modeInfo: Array<{mode:Mode;label:string;icon:typeof MousePointer2}>=[{mode:'observe',label:'观察',icon:ScanLine},{mode:'interact',label:'交互',icon:Hand},{mode:'design',label:'设计',icon:MousePointer2},{mode:'annotate',label:'批注',icon:Pencil}];
const statusNames: Record<string,string>={live:'实时同步',frozen:'已冻结',stale:'画面已过期',disconnected:'连接已断开',connecting:'正在连接',resyncing:'正在重同步','build-failed':'构建失败'};
const changeNames:Record<string,string>={prepared:'候选已准备',verifying:'正在验证',verified:'验证通过 · 待接受',failed:'验证失败',accepted:'已接受',reverted:'已回退',discarded:'已丢弃'};
const short=(s:string)=>s.replace('sha256:','').slice(0,8);
const stamp=(s:string)=>new Date(s).toLocaleTimeString('zh-CN',{hour12:false});
const initialProps={text:'',borderRadius:'12',fontSize:'14',gap:'24',background:'',color:'',gridTemplateColumns:''};

export function Workbench(){
  const [state,setState]=useState<BridgeState|null>(null);
  const [live,setLive]=useState<RuntimeFrame|null>(null);
  const [active,setActive]=useState<RuntimeFrame|null>(()=>{try{const f=JSON.parse(localStorage.getItem('rd-draft-frame')||'null');return f?.image?.startsWith('data:image/png;base64,')&&Array.isArray(f.nodes)?f:null;}catch{return null;}});
  const [connected,setConnected]=useState(false);
  const [mode,setMode]=useState<Mode>('design');
  const [tab,setTab]=useState<Tab>('pages');
  const [inspector,setInspector]=useState<Inspector>(new URLSearchParams(location.search).get('review')==='1'?'tasks':'properties');
  const [selectedId,setSelectedId]=useState<string>(()=>new URLSearchParams(location.search).get('selected')||'');
  const [properties,setProperties]=useState(initialProps);
  const [changedProps,setChangedProps]=useState<Set<string>>(new Set());
  const [intent,setIntent]=useState('');
  const [understanding,setUnderstanding]=useState(false);
  const [complexIntent,setComplexIntent]=useState(false);
  const [agentRun,setAgentRun]=useState<{id:string;status:string;lease:{generation:number};logs:string[];changeSetId:string}|null>(()=>{try{const r=JSON.parse(localStorage.getItem('rd-agent-run')||'null');return r?.id&&r?.changeSetId&&r?.lease?r:null;}catch{return null;}});
  const [busy,setBusy]=useState('');
  const [toast,setToast]=useState('');
  const [note,setNote]=useState(()=>localStorage.getItem('rd-draft-note')||'');
  const [strokes,setStrokes]=useState<Stroke[]>(()=>{try{return JSON.parse(localStorage.getItem('rd-draft-strokes')||'[]');}catch{return [];}});
  const [outbox,setOutbox]=useState<PendingAnnotation[]>(()=>readOutbox(localStorage));
  const [zoom,setZoom]=useState(1);
  const [canvasWidth,setCanvasWidth]=useState(1000);
  const [drawer,setDrawer]=useState(new URLSearchParams(location.search).get('review')==='1');
  const [selectedChangeId,setSelectedChangeId]=useState('');
  const [compare,setCompare]=useState(false);
  const [pairing,setPairing]=useState(false);
  const [pairCode,setPairCode]=useState('');
  const [pairExpires,setPairExpires]=useState('');
  const [pairName,setPairName]=useState('iPad 工作台');
  const [authRequired,setAuthRequired]=useState(false);
  const [sidebarOpen,setSidebarOpen]=useState(false);
  const [inspectorOpen,setInspectorOpen]=useState(false);
  const [reference,setReference]=useState<Asset|null>(null);
  const [localDesign,setLocalDesign]=useState(false);
  const [designFrame,setDesignFrame]=useState<Project['designFrames'][number]|null>(null);
  const [intentAnnotationId,setIntentAnnotationId]=useState('');
  const [assetPrompt,setAssetPrompt]=useState('');
  const [assetBudget,setAssetBudget]=useState('1');
  const [assetApproved,setAssetApproved]=useState(false);
  const [nodeFilter,setNodeFilter]=useState('');
  const nativeEligibleRef=useRef(true);
  const stateRef=useRef(state); const activeRef=useRef(active); const liveRef=useRef(live); const modeRef=useRef(mode);
  const strokeRef=useRef<Stroke|null>(null); const wsRef=useRef<WebSocket|null>(null);
  const surfaceRef=useRef<HTMLDivElement>(null); const canvasScrollRef=useRef<HTMLDivElement>(null); const retryRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const fileRef=useRef<HTMLInputElement>(null); const importRef=useRef<HTMLInputElement>(null);
  nativeEligibleRef.current=!reference&&!localDesign;stateRef.current=state;activeRef.current=active;liveRef.current=live;modeRef.current=mode;
  const frame=active||live;
  const selected=frame?.nodes.find(n=>n.runtimeNodeId===selectedId);
  const change=state?.changes.find(c=>c.id===selectedChangeId)||state?.changes.at(-1);
  const isLive=!active&&!reference&&!localDesign;
  const runtimeReady=connected&&live?.status==='live';
  const editable=runtimeReady&&!!selected?.binding&&selected.binding.reliability==='exact'&&isLive&&connected;

  function message(text:string){setToast(text);}
  async function refresh(){const s=await api<BridgeState>('/state');setState(s);stateRef.current=s;if(s.frame)setLive(s.frame);return s;}
  async function run(name:string,fn:()=>Promise<void>){setBusy(name);try{await fn();}catch(e){message(e instanceof Error?e.message:String(e));}finally{setBusy('');}}
  async function write<T>(path:string,extra:Record<string,unknown>={}){const current=await api<BridgeState>('/state');stateRef.current=current;setState(current);return api<T>(path,{...envelope(current.project),...extra});}
  async function syncAnnotations(){
    const queue=readOutbox(localStorage);
    for(const pending of queue){
      const current=await api<BridgeState>('/state');stateRef.current=current;setState(current);
      await api('/annotations',{...envelope(current.project,pending.operationId),annotation:pending.annotation,...(pending.frozenFrame?{frozenFrame:pending.frozenFrame}:{})});
      setOutbox(acknowledge(localStorage,pending.operationId));
    }
    if(queue.length)await refresh();
  }
  async function reconnect(){
    try{await refresh();connect();}
    catch(e){if(e instanceof ApiError&&e.status===401){if(['localhost','127.0.0.1','[::1]'].includes(location.hostname)){try{setToken('');await bootstrap();await refresh();connect();return;}catch{}}else{setToken('');setAuthRequired(true);return;}}retryRef.current=setTimeout(()=>void reconnect(),2000);}
  }
  function connect(){
    const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws?token=${encodeURIComponent(getToken())}`);wsRef.current=ws;
    ws.onopen=()=>{setConnected(true);setAuthRequired(false);void syncAnnotations().catch(e=>message('离线批注已保留：'+e.message));};
    ws.onmessage=e=>{try{const event=JSON.parse(e.data) as ServerEvent;if(event.type==='frame'){setLive(event.frame);}else if(event.type==='state'){setState(event.state);if(event.state.frame)setLive(event.state.frame);}else{message(event.error.message);}}catch{message('同步协议异常，正在请求完整状态');void refresh();}};
    ws.onclose=()=>{setConnected(false);setMode('observe');if(!getToken())return;retryRef.current=setTimeout(()=>void reconnect(),2000);};
    ws.onerror=()=>ws.close();
  }
  useEffect(()=>{
    let disposed=false;
    const open=async()=>{try{await bootstrap();await refresh();if(!disposed)connect();}catch{if(['localhost','127.0.0.1','[::1]'].includes(location.hostname)){try{setToken('');await bootstrap();await refresh();if(!disposed)connect();return;}catch{}}if(!disposed)setAuthRequired(true);}};void open();
    return ()=>{disposed=true;if(retryRef.current)clearTimeout(retryRef.current);if(wsRef.current){wsRef.current.onclose=null;wsRef.current.close();}};
  },[]);
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),6500);return()=>clearTimeout(t);},[toast]);
  useEffect(()=>{const el=canvasScrollRef.current;if(!el)return;const observer=new ResizeObserver(()=>setCanvasWidth(el.clientWidth));observer.observe(el);setCanvasWidth(el.clientWidth);return()=>observer.disconnect();},[!!state]);
  useEffect(()=>{localStorage.setItem('rd-draft-strokes',JSON.stringify(strokes));const f=activeRef.current||liveRef.current;if((strokes.length||note.trim())&&f)localStorage.setItem('rd-draft-frame',JSON.stringify({...f,kind:'snapshot',status:'frozen'}));else localStorage.removeItem('rd-draft-frame');},[strokes,note]);
  useEffect(()=>{localStorage.setItem('rd-draft-note',note);},[note]);
  useEffect(()=>{
    const n=selected;if(!n)return;
    setProperties({text:n.text,borderRadius:n.styles.borderRadius?.replace('px','')||'0',fontSize:n.styles.fontSize?.replace('px','')||'14',gap:n.styles.gap?.replace('px','')||'0',background:n.styles.backgroundColor||'',color:n.styles.color||'',gridTemplateColumns:n.styles.gridTemplateColumns||''});
    setChangedProps(new Set());setUnderstanding(false);
  },[selectedId]);
  useEffect(()=>{
    const receiver=(event:Event)=>{const d=(event as CustomEvent<{nativeData:string;strokes:Stroke[];frameId:string}>).detail;const f=activeRef.current||liveRef.current;if(!nativeEligibleRef.current||modeRef.current!=='annotate'||!f||d?.frameId!==f.id||!Array.isArray(d.strokes)||typeof d.nativeData!=='string'||d.nativeData.length>12*1024*1024)return;if(!activeRef.current&&liveRef.current)setActive({...liveRef.current,status:'frozen',kind:'snapshot'});setStrokes(s=>[...s.filter(v=>!v.id.startsWith(`pencil-${d.frameId}-`)),...d.strokes.map((v,i)=>({...v,...(i===0?{nativeData:d.nativeData}:{})}))]);};
    window.addEventListener('rdesign-native-strokes',receiver);
    (window as unknown as Record<string,unknown>).__RDESIGN_WORKBENCH__={frame:()=>activeRef.current||liveRef.current,mode:()=>modeRef.current,nativeTarget:()=>{const el=surfaceRef.current;const f=activeRef.current||liveRef.current;if(!nativeEligibleRef.current||!el||!f)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,frameWidth:f.width,frameHeight:f.height,frameId:f.id,mode:modeRef.current,viewportWidth:window.innerWidth};},addNativeDrawing:(detail:unknown)=>{if(!nativeEligibleRef.current||modeRef.current!=='annotate'||!surfaceRef.current||!(activeRef.current||liveRef.current)||(detail as {frameId?:string})?.frameId!==(activeRef.current||liveRef.current)!.id)return {accepted:false,frameId:null};window.dispatchEvent(new CustomEvent('rdesign-native-strokes',{detail}));return {accepted:true,frameId:(activeRef.current||liveRef.current)!.id};}};
    return()=>window.removeEventListener('rdesign-native-strokes',receiver);
  },[]);

  async function changeMode(next:Mode){
    if(next==='annotate'&&!active&&live)setActive({...live,kind:'snapshot',status:'frozen'});
    setMode(next);
    if(next!=='annotate'&&active?.id===live?.id)setActive(null);
    if(state&&connected)await run('mode',async()=>{await write('/mode',{mode:next});});
  }
  function selectNode(node:ObservedNode){setSelectedId(node.runtimeNodeId);setInspector('properties');setInspectorOpen(true);setReference(null);setLocalDesign(false);}
  function coords(e:{clientX:number;clientY:number}){const rect=surfaceRef.current!.getBoundingClientRect();return {x:(e.clientX-rect.left)/rect.width*frame!.width,y:(e.clientY-rect.top)/rect.height*frame!.height};}
  async function pointerDown(e:ReactPointerEvent){
    if(!frame||reference||localDesign)return;
    if(mode==='annotate'){
      if(!active&&live)setActive({...live,kind:'snapshot',status:'frozen'});
      e.currentTarget.setPointerCapture(e.pointerId);
      const p=coords(e);const stroke:Stroke={id:crypto.randomUUID(),color:'#e58b43',width:3,points:[{...p,pressure:e.pressure||0.5,time:Date.now()}]};
      strokeRef.current=stroke;setStrokes(s=>[...s,stroke]);return;
    }
    const point=coords(e);
    if(mode==='interact'){
      if(!runtimeReady||!isLive)return message('请回到实时画板后交互');
      await run('input',async()=>{await write('/input',{version:versionOf(frame),action:'click',...point});});return;
    }
    if(mode==='design'){
      const candidates=frame.nodes.filter(n=>point.x>=n.bounds.x&&point.x<=n.bounds.x+n.bounds.w&&point.y>=n.bounds.y&&point.y<=n.bounds.y+n.bounds.h).sort((a,b)=>(a.bounds.w*a.bounds.h)-(b.bounds.w*b.bounds.h));
      if(candidates[0])selectNode(candidates[0]);
    }
  }
  function pointerMove(e:ReactPointerEvent){const s=strokeRef.current;if(!s||!frame)return;const p=coords(e);s.points.push({...p,pressure:e.pressure||0.5,time:Date.now()});setStrokes(st=>st.map(v=>v.id===s.id?{...s,points:[...s.points]}:v));}
  function pointerUp(){strokeRef.current=null;}
  async function saveAnnotation(){
    if(!frame||!state)return;
    if(!note.trim()&&!strokes.length)return message('请先写下意见或绘制笔迹');
    const bounds=selected?.bounds||strokeBounds(strokes.flatMap(s=>s.points));
    const annotation:Annotation={id:crypto.randomUUID(),projectId:state.project.id,revision:1,createdAt:new Date().toISOString(),anchor:{type:selected?'object':'snapshot',runtimeNodeId:selected?.runtimeNodeId,frameId:frame.id,bounds,version:versionOf(frame)},text:note,strokes,status:'comment'};
    setOutbox(putOutbox(localStorage,{annotation,operationId:crypto.randomUUID(),frozenFrame:frame}));setNote('');setStrokes([]);
    if(connected)await run('annotation',async()=>{await syncAnnotations();message('批注已保存；确认意图后才会创建修改任务');});else message('批注已保存在本机，恢复连接后同步');
  }
  async function prepareChange(){
    if(!selected?.sourceNodeId||!frame||!state)return;
    const props:Record<string,string|number>={};changedProps.forEach(k=>{const v=properties[k as keyof typeof properties];props[k]=['borderRadius','fontSize','gap'].includes(k)?Number(v):v;});
    if(!Object.keys(props).length&&!complexIntent)return message('请先修改一个可写属性');
    if(complexIntent&&!intent.trim())return message('请明确复杂修改意图');
    await run('prepare',async()=>{
      let annotationId=intentAnnotationId;
      if(complexIntent&&!annotationId){annotationId=crypto.randomUUID();const annotation:Annotation={id:annotationId,projectId:state.project.id,revision:1,createdAt:new Date().toISOString(),anchor:{type:'object',runtimeNodeId:selected.runtimeNodeId,frameId:frame.id,bounds:selected.bounds,version:versionOf(frame)},text:intent,strokes:[],status:'comment'};await write('/annotations',{annotation,frozenFrame:frame});setIntentAnnotationId(annotationId);}
      if(annotationId){const ann=stateRef.current?.project.annotations.find(a=>a.id===annotationId);if(ann)await write(`/annotations/${ann.id}/confirm`,{intent:{summary:intent||ann.text,constraints:['保留数据请求、事件处理和键盘可访问性'],version:(ann.intent?.version||0)+1}});}
      const c=await write<ChangeSet>('/changes/prepare',{nodeId:selected.runtimeNodeId,sourceNodeId:selected.sourceNodeId,version:versionOf(frame),intent:intent||`修改 ${selected.tag} 的 ${Object.keys(props).join('、')}`,properties:complexIntent?{}:props,scope:selected.binding?.scope||'instance',...(annotationId?{annotationId}:{}),...(complexIntent?{executionMode:'agent'}:{})});
      if(complexIntent){const r=await write<{id:string;status:string;lease:{generation:number};logs:string[]}>('/agent/runs',{changeSetId:c.id,annotationId,budget:{maxUsd:1,maxIterations:1}});setAgentRun({...r,changeSetId:c.id});}
      setSelectedChangeId(c.id);setUnderstanding(false);setDrawer(true);setInspector('tasks');await refresh();message('已创建隔离候选，接下来运行验证');
    });
  }
  useEffect(()=>{if(agentRun)localStorage.setItem('rd-agent-run',JSON.stringify(agentRun));else localStorage.removeItem('rd-agent-run');},[agentRun]);
  useEffect(()=>{if(!state||!agentRun||!['submitted','running'].includes(agentRun.status))return;let disposed=false;const t=setInterval(()=>{void api<{id:string;status:string;lease:{generation:number};logs:string[]}>(`/agent/runs/${agentRun.id}`).then(r=>{if(!disposed)setAgentRun({...r,changeSetId:agentRun.changeSetId});}).catch(e=>message(e.message));},3000);return()=>{disposed=true;clearInterval(t);};},[agentRun?.id,agentRun?.status,!!state]);
  async function changeAction(action:'verify'|'apply'|'revert'|'discard'){
    if(!change)return;
    await run(action,async()=>{await write(`/changes/${change.id}/${action}`,action==='apply'?{diffHash:change.diffHash}:{});await refresh();message(action==='apply'?'变更已接受，正在同步真实运行结果':action==='revert'?'已创建并应用目标变更的反向修改':action==='verify'?'验证已完成，请审查代码和截图':'候选已丢弃');if(action==='apply'||action==='revert'){setActive(null);setCompare(false);}});
  }
  async function freeze(){await run('snapshot',async()=>{const f=await write<RuntimeFrame>('/snapshots');setActive(f);await refresh();message('已保存不可变快照');});}
  function returnLive(){if(strokes.length||note.trim())return message('请先保存或清除本地批注草稿，再切换实时画板');setActive(null);setReference(null);setLocalDesign(false);setCompare(false);setSelectedId('');setStrokes([]);}
  async function captureScenario(id:string){await run('scenario',async()=>{const f=await write<RuntimeFrame>(`/scenarios/${id}/capture`);setActive(f);setReference(null);setLocalDesign(false);await refresh();});}
  async function pair(){setPairing(true);await run('pairing',async()=>{const p=await write<{code:string;expiresAt:string}>('/pairing/code');setPairCode(p.code);setPairExpires(p.expiresAt);});}
  async function redeem(){await run('redeem',async()=>{const p=await api<{token:string}>('/pairing/redeem',{code:pairCode,name:pairName});setToken(p.token);await refresh();setAuthRequired(false);connect();});}
  async function uploadAsset(file:File){
    if(!['image/png','image/jpeg','image/webp'].includes(file.type))return message('支持 PNG、JPEG、WebP 图片');
    if(file.size>10*1024*1024)return message('图片请控制在 10 MB 以内');
    const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(file);});
    await run('asset',async()=>{await write('/assets/import',{name:file.name,dataUrl});await refresh();setTab('assets');message('参考图已保存，来源与哈希可追溯');});
  }
  async function exportProject(){await run('export',async()=>{const p=await api<Project>('/export');const url=URL.createObjectURL(new Blob([JSON.stringify(p,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='rdesign-project.json';a.click();URL.revokeObjectURL(url);});}
  async function importProject(file:File){await run('import',async()=>{const doc=JSON.parse(await file.text());await write('/import',{document:doc});await refresh();message('项目文档已导入');});}
  function editProperty(key:string,value:string){setProperties(p=>({...p,[key]:value}));setChangedProps(p=>new Set([...p,key]));setUnderstanding(false);}
  const visibleNodes=(frame?.nodes||[]).filter(n=>n.text.toLowerCase().includes(nodeFilter.toLowerCase())||n.tag.includes(nodeFilter)||n.sourceNodeId?.includes(nodeFilter));
  const savedAnnotations=state?.project.annotations||[];

  if(authRequired)return <div className="auth-screen"><div className="auth-card"><Brand/><div className="auth-icon"><Link2 size={32}/></div><h1>连接你的设计工作区</h1><p>在桌面工作台创建一次性配对码，让这台设备跟随同一个真实运行实例。</p><label>设备名称<input value={pairName} onChange={e=>setPairName(e.target.value)}/></label><label>一次性配对码<input placeholder="输入桌面显示的配对码" value={pairCode} onChange={e=>setPairCode(e.target.value)}/></label><button className="primary" onClick={()=>void redeem()} disabled={!!busy}><Link2 size={16}/>配对并进入工作台</button><small>Bridge 默认只监听本机。跨设备连接须由桌面显式启用可信局域网通道。</small>{toast&&<div className="inline-error">{toast}</div>}</div></div>;
  if(!state)return <div className="auth-screen"><div className="loading"><Brand/><Loader2 className="spin"/><p>正在连接工作区与运行实例…</p></div></div>;
  return <div className="workbench">
    <header className="topbar">
      <button className="mobile-only icon-button" onClick={()=>setSidebarOpen(v=>!v)} aria-label="页面目录"><Layers size={18}/></button><Brand/>
      <span className="top-divider"/><button className="project-name" onClick={()=>void exportProject()}><FolderOpen size={16}/><span>{state.project.name}</span><ChevronDown size={13}/></button>
      <div className="session-tag"><Circle size={7} fill="currentColor"/>开发实例<span>{live?.runtimeSessionId?short(live.runtimeSessionId):'连接中'}</span></div>
      <div className="top-spacer"/><span className={'connection '+(connected?'':'offline')}>{connected?<Wifi size={14}/>:<WifiOff size={14}/>}<span>{connected?'Bridge 已连接':'离线 · 本地保存'}</span></span>
      <button className="top-button" onClick={()=>void pair()}><Link2 size={15}/><span>配对设备</span></button><button className="avatar" aria-label="本地工作区">L</button>
    </header>
    <div className="workspace-body">
      <aside className={'sidebar '+(sidebarOpen?'open':'')}>
        <div className="sidebar-title"><div><span className="eyebrow">WORKSPACE</span><h2>设计资源</h2></div><button className="icon-button" aria-label="关闭目录" onClick={()=>setSidebarOpen(false)}><PanelLeftClose size={17}/></button></div>
        <div className="sidebar-tabs">{(['pages','layers','assets'] as Tab[]).map((t,i)=><button key={t} className={tab===t?'active':''} onClick={()=>setTab(t)}>{['页面','图层','资产'][i]}</button>)}</div>
        {tab==='pages'&&<>
          <div className="section-label">页面与状态<span>{state.project.scenarios.length}</span></div>
          <button className={'page-item '+(isLive?'active':'')} onClick={returnLive}><div className="page-symbol"><Monitor size={17}/></div><div><strong>设备总览</strong><small>同一实例 · 实时画板</small></div><span className="tiny-live">LIVE</span></button>
          {state.project.scenarios.map(s=><button key={s.id} className="page-item scenario" data-testid={'scenario-'+s.id} onClick={()=>{void captureScenario(s.id);setSidebarOpen(false);}}><div className="page-symbol"><FileText size={16}/></div><div><strong>{s.name}</strong><small>{s.viewport.width} × {s.viewport.height} · {s.status==='fresh'?'最新快照':s.status==='stale'?'待刷新':'尚未采集'}</small></div>{s.status==='stale'?<RefreshCw size={12}/>:<ChevronRight size={12}/>}</button>)}
          <div className="section-label spaced">画板<span>{state.project.snapshots.length+state.project.designFrames.length}</span></div>
          <button className="subtle-row" onClick={()=>{setLocalDesign(true);setDesignFrame(null);setReference(null);}}><Plus size={15}/>新建设计画板</button>
          {state.project.designFrames.map(d=><button className="snapshot-item" key={d.id} onClick={()=>{setDesignFrame(d);setLocalDesign(true);setReference(null);}}><Layers size={14}/><span>{d.name}</span><small>{d.nodes.length} 个节点</small></button>)}
          {state.project.snapshots.slice(-5).reverse().map(s=><button className={'snapshot-item '+(active?.id===s.id?'active':'')} key={s.id} onClick={()=>{setActive(s);setReference(null);setLocalDesign(false);}}><FileImage size={14}/><span>冻结快照</span><small>{stamp(s.timestamp)}</small></button>)}
          {state.changes.filter(c=>c.candidateFrame).slice(-4).map(c=><button className="snapshot-item" key={c.id} onClick={()=>{setSelectedChangeId(c.id);setActive(c.candidateFrame!);setInspector('tasks');setDrawer(true);}}><GitBranch size={14}/><span>候选 {short(c.id)}</span><small>{changeNames[c.status]}</small></button>)}
        </>}
        {tab==='layers'&&<><div className="layer-search"><Search size={14}/><input value={nodeFilter} onChange={e=>setNodeFilter(e.target.value)} placeholder="查找控件"/></div><div className="section-label">运行控件树<span>{visibleNodes.length}</span></div><div className="layer-list">{visibleNodes.map(n=><button key={n.runtimeNodeId} data-testid={'node-'+n.sourceNodeId} className={'layer-row '+(selectedId===n.runtimeNodeId?'selected':'')} onClick={()=>selectNode(n)} title={n.runtimeNodeId}><Box size={13}/><span>{n.text?.slice(0,22)||n.sourceNodeId||n.tag}</span><small>{n.tag}</small></button>)}</div></>}
        {tab==='assets'&&<><div className="section-label">参考与生成资产<span>{state.project.assets.length}</span></div><button className="asset-upload" onClick={()=>fileRef.current?.click()}><Plus size={19}/><strong>导入参考图</strong><small>PNG、JPEG、WebP</small></button>{state.project.assets.map(a=><button className="asset-card" key={a.id} onClick={()=>{setReference(a);setLocalDesign(false);}}><img src={a.url} alt={a.name}/><strong>{a.name}</strong><small>{a.kind==='generated'?'AI 视觉素材':'原始参考'} · {short(a.hash)}</small></button>)}<div className="provider-info"><Sparkles size={17}/><strong>AI 资产提供方</strong><small>{state.providerStatus.assets}</small><p>生成图保存为独立素材，确认并实现后才成为真实 UI。</p><textarea value={assetPrompt} onChange={e=>setAssetPrompt(e.target.value)} placeholder="描述需要的图标、插画或视觉方向…" rows={3}/><label className="property-label">单次批准预算（USD）<input type="number" value={assetBudget} min="0.01" step="0.1" onChange={e=>setAssetBudget(e.target.value)}/></label><label className="check-label"><input type="checkbox" checked={assetApproved} onChange={e=>setAssetApproved(e.target.checked)}/>允许向配置提供方发送此提示词并产生费用</label><button className="primary full" disabled={!state.capabilities.assets||!assetPrompt.trim()||!assetApproved||!!busy} onClick={()=>void run("generate",async()=>{await write("/assets/generate",{prompt:assetPrompt,budgetUsd:Number(assetBudget),externalGenerationApproved:true});await refresh();setAssetApproved(false);message("视觉素材已生成，来源与批准预算已保存");})}><Sparkles size={14}/>生成视觉素材</button></div></>}
        <div className="sidebar-bottom"><div className="project-progress"><ShieldCheck size={16}/><span>文档版本 <strong>v{state.project.revision}</strong></span><span className="saved-dot"/></div><div className="sidebar-actions"><button onClick={()=>void exportProject()}><ArrowDownToLine size={14}/>导出</button><button onClick={()=>importRef.current?.click()}><FolderOpen size={14}/>导入</button><button onClick={()=>{setDrawer(v=>!v);setInspector('tasks');}}><History size={14}/>历史</button></div></div>
      </aside>
      <main className="canvas-area">
        <div className="canvas-header"><div><span className="breadcrumb">{reference?'参考素材':localDesign?'设计画板':'设备监控 / 总览'}</span><h1>{reference?.name||(localDesign?'无标题设计稿':active?.kind==='candidate'?'候选验证快照':active?'冻结快照':'设备总览')}<span className={'frame-type '+(!connected&&isLive?'stale':'')}>{reference?'REFERENCE':localDesign?'DESIGN':active?.kind==='candidate'?'CANDIDATE':active?'SNAPSHOT':'LIVE CANVAS'}</span></h1></div><div className="canvas-header-actions"><button title="保存快照" data-testid="freeze-frame" onClick={()=>void freeze()} disabled={!!busy||!connected}><FileImage size={16}/></button><button title="查看变更" onClick={()=>setDrawer(v=>!v)}><Code2 size={17}/></button><button className="mobile-only" onClick={()=>setInspectorOpen(v=>!v)} title="属性面板"><Settings2 size={17}/></button></div></div>
        <div className="canvas-subbar"><span className="runtime-fact"><span className={'state-dot '+(connected?'':'stale')}/>{active?statusNames[active.status]:connected?statusNames[live?.status||'live']:'已过期 · 输入停用'}</span><span className="subbar-divider"/><span>{frame?`${frame.width} × ${frame.height}`:'正在采集'}</span><span className="subbar-divider"/><GitBranch size={12}/><span>{frame?short(frame.codeRevision):'—'}</span><div className="flex-fill"/>{active&&<button onClick={returnLive}><Radio size={13}/>回到实时</button>}<button onClick={()=>void run('viewport',async()=>{await write('/viewport',{width:1100,height:740});setActive(null);})}><Monitor size={13}/>桌面</button><button onClick={()=>void run('viewport',async()=>{await write('/viewport',{width:390,height:844});setActive(null);})}><Smartphone size={13}/>窄屏</button></div>
        <div className="canvas-scroll" ref={canvasScrollRef}>
          {compare&&change?.candidateFrame&&<div className="comparison-label"><ArrowLeftRight size={15}/>基准与候选 · 截图对应各自的代码版本<button onClick={()=>setCompare(false)}><X size={15}/></button></div>}
          <div className={'canvas-frames '+(compare?'compare':'')}>
            <div className="artboard-wrap" style={{width:reference?'min(100%, 960px)':localDesign?780:frame?Math.min(frame.width,canvasWidth-(canvasWidth<650?26:56))*zoom:900}}>
              <div className="artboard-label"><span>{reference?'原始参考 · 保留来源':localDesign?'DesignFrame · 结构化设计':compare?'BASELINE / 基准':'MAIN SURFACE / 主表面'}</span><span>{frame&&!reference&&!localDesign?stamp(frame.timestamp):''}</span></div>
              {reference?<img className="reference-image" src={reference.url} alt={reference.name}/>:localDesign?<DesignBoard key={designFrame?.id||'new'} initialNodes={designFrame?.nodes} onSave={async nodes=>{await run('design',async()=>{await write('/design-frames',{frame:{id:crypto.randomUUID(),name:designFrame?designFrame.name+' · 新版本':'无标题设计稿',nodes}});await refresh();message('结构化设计画板已保存');});}}/>:frame?<div ref={surfaceRef} data-rdesign-native-canvas="true" className={'canvas-surface mode-'+mode} data-testid="canvas-surface" style={{aspectRatio:`${frame.width}/${frame.height}`}} tabIndex={0} onPointerDown={e=>void pointerDown(e)} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onWheel={e=>{if(mode==='interact'&&runtimeReady&&isLive){e.preventDefault();void write('/input',{version:versionOf(frame),action:'scroll',deltaY:e.deltaY}).catch(err=>message(err.message));}}} onKeyDown={e=>{if(mode==='interact'&&runtimeReady&&isLive&&!e.nativeEvent.isComposing&&!['Shift','Control','Alt','Meta','Dead','Unidentified'].includes(e.key)){e.preventDefault();const key=e.key===' '?'Space':e.key==='Tab'&&e.shiftKey?'Shift+Tab':e.key.toLowerCase()==='a'&&(e.ctrlKey||e.metaKey)?(e.metaKey?'Meta+A':'Control+A'):e.key;void write('/input',{version:versionOf(frame),action:'key',key}).catch(err=>message(err.message));}}}>
                <img className="runtime-image" src={frame.image} alt="真实运行实例画面" draggable={false}/>
                <svg className="canvas-overlay" viewBox={`0 0 ${frame.width} ${frame.height}`} preserveAspectRatio="none">
                  {selected&&<g><rect x={selected.bounds.x} y={selected.bounds.y} width={selected.bounds.w} height={selected.bounds.h} fill="rgba(59,155,136,.08)" stroke="#279c85" strokeWidth="2"/><rect x={selected.bounds.x} y={Math.max(0,selected.bounds.y-23)} width={Math.max(110,selected.tag.length*9+90)} height="22" rx="3" fill="#238d78"/><text x={selected.bounds.x+7} y={Math.max(0,selected.bounds.y-23)+15} fill="white" fontSize="11">{selected.tag} · {Math.round(selected.bounds.w)} × {Math.round(selected.bounds.h)}</text>{[[0,0],[1,0],[0,1],[1,1]].map(([x,y],i)=><rect key={i} x={selected.bounds.x+x*selected.bounds.w-3} y={selected.bounds.y+y*selected.bounds.h-3} width="6" height="6" fill="white" stroke="#238d78"/>)}</g>}
                  {strokes.map(s=><polyline key={s.id} points={s.points.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke={s.color} strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round"/>)}
                  {savedAnnotations.filter(a=>a.anchor.type==='object'?frame.nodes.some(n=>n.runtimeNodeId===a.anchor.runtimeNodeId):a.anchor.frameId===frame.id).map((a,i)=>{const b=a.anchor.type==='object'?frame.nodes.find(n=>n.runtimeNodeId===a.anchor.runtimeNodeId)!.bounds:a.anchor.bounds;return <g key={a.id}>{a.strokes.map(s=><polyline key={s.id} points={s.points.map(p=>`${p.x+(a.anchor.type==='object'?b.x-a.anchor.bounds.x:0)},${p.y+(a.anchor.type==='object'?b.y-a.anchor.bounds.y:0)}`).join(' ')} fill="none" stroke={s.color} strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round"/>)}<circle cx={b.x+b.w} cy={b.y} r="10" fill="#e58b43"/><text x={b.x+b.w} y={b.y+4} textAnchor="middle" fill="white" fontSize="10">{i+1}</text></g>;})}
                </svg>
                {!connected&&isLive&&<div className="stale-banner"><WifiOff size={16}/>最后画面已过期 · {stamp(frame.timestamp)} · 远程输入已停用</div>}
              </div>:<div className="empty-canvas"><Loader2 className="spin"/><strong>正在启动受控 React 实例</strong><small>首次连接会采集真实画面与控件结构</small></div>}
              {!reference&&!localDesign&&<div className="artboard-footer"><span><ShieldCheck size={12}/>真实运行画面</span><span>结构 v{frame?.treeRevision||0} · 几何 v{frame?.geometryRevision||0} · {frame?.nodes.length||0} 个控件</span></div>}
            </div>
            {compare&&change?.candidateFrame&&<div className="artboard-wrap"><div className="artboard-label"><span>CANDIDATE / 候选</span><span>{short(change.candidateFrame.codeRevision)}</span></div><img className="candidate-image" src={change.candidateFrame.image} alt="候选验证截图"/><div className="artboard-footer">{changeNames[change.status]}</div></div>}
          </div>
        </div>
        <div className="floating-tools">{modeInfo.map(({mode:m,label,icon:Icon})=><button key={m} data-testid={'mode-'+m} className={mode===m?'active':''} onClick={()=>void changeMode(m)} title={label}><Icon size={18}/><span>{label}</span></button>)}<span className="tool-divider"/><button title="缩小" onClick={()=>setZoom(z=>Math.max(.35,z-.1))}><ZoomOut size={17}/></button><span className="zoom-value">{frame?Math.round(Math.min(frame.width,canvasWidth-(canvasWidth<650?26:56))*zoom/frame.width*100):100}%</span><button title="放大" onClick={()=>setZoom(z=>Math.min(2,z+.1))}><ZoomIn size={17}/></button><button title="适合画布" onClick={()=>setZoom(1)}><Maximize2 size={16}/></button></div>
        {mode==='annotate'&&<div className="annotation-hint"><Pencil size={13}/>本地即时笔迹 · 源画面已冻结 · 不触发业务控件</div>}
        <div className="canvas-status"><span><Activity size={12}/>{busy?'处理中…':'单活跃画板 · 低帧率 PNG 真实画面'}</span><span>{outbox.length?`${outbox.length} 条批注等待同步`:'文档与批注独立保存'}<button onClick={()=>setDrawer(v=>!v)}><Code2 size={12}/>{drawer?'收起':'差异与验证'}</button></span></div>
        {drawer&&<div className="evidence-drawer"><div className="drawer-title"><span><GitBranch size={15}/>变更与验证证据</span><span>{change?short(change.id):'尚无变更'}<button onClick={()=>setDrawer(false)}><X size={16}/></button></span></div>{change?<><div className="evidence-summary"><strong>{change.intent}</strong><span className={'change-status '+change.status}>{changeNames[change.status]}</span>{change.candidateFrame&&<button className="text-button" onClick={()=>{setCompare(true);setActive(null);}}>对比画面 <ArrowLeftRight size={13}/></button>}</div><div className="drawer-content"><div className="diff-pane">{change.patches.map(p=><div key={p.file}><span className="diff-file">{p.file}</span><pre>{simpleDiff(p.before,p.after)}</pre></div>)}</div><div className="evidence-pane">{change.evidence.length?change.evidence.map((e,i)=><div key={i} className={'evidence-row '+(e.passed?'pass':'fail')}>{e.passed?<CheckCircle2 size={15}/>:<X size={15}/>}<div><strong>{e.name}</strong><small>{e.detail}</small></div></div>):<p>候选已准备，运行验证后生成真实截图和行为证据。</p>}{change.error&&<div className="inline-error">{change.error}</div>}</div></div></>:<div className="drawer-empty">选择一个有源码映射的控件，修改属性并创建候选。每次变更都保留代码差异与验证结果。</div>}</div>}
      </main>
      <aside className={'inspector '+(inspectorOpen?'open':'')}>
        <div className="inspector-tabs">{(['properties','annotations','tasks'] as Inspector[]).map((t,i)=><button key={t} className={inspector===t?'active':''} onClick={()=>setInspector(t)}>{['属性','批注','任务'][i]}{t==='annotations'&&savedAnnotations.length>0&&<span>{savedAnnotations.length}</span>}</button>)}<button className="mobile-only" onClick={()=>setInspectorOpen(false)} aria-label="关闭属性"><X size={15}/></button></div>
        <div className="inspector-scroll">
        {inspector==='properties'&&<>
          <div className="selection-heading"><div className="selection-icon"><MousePointer2 size={19}/></div><div><span className="eyebrow">SELECTED OBJECT</span><h3>{selected?selected.sourceNodeId||selected.tag:'选择一个控件'}</h3></div></div>
          {selected?<><div className="node-meta"><span>{selected.tag.toUpperCase()}</span><span>{selected.binding?.reliability==='exact'?'L3 · 源码已映射':'L2 · 结构观察'}</span></div><div className="property-section"><div className="property-title">布局与几何<ScanLine size={13}/></div><div className="geometry-grid">{[['X',selected.bounds.x],['Y',selected.bounds.y],['W',selected.bounds.w],['H',selected.bounds.h]].map(([k,v])=><div key={k}><span>{k}</span><strong>{Math.round(Number(v))}</strong></div>)}</div></div>
          <div className="property-section"><div className="property-title">外观与内容<Settings2 size={14}/></div><label className="property-label">文字<textarea data-testid="property-text" value={properties.text} onChange={e=>editProperty('text',e.target.value)} disabled={!editable||!selected.binding?.editableProperties.includes('text')} rows={2}/></label><div className="property-columns"><label className="property-label">圆角 <span>px</span><input data-testid="property-borderRadius" type="number" min="0" max="200" value={properties.borderRadius} onChange={e=>editProperty('borderRadius',e.target.value)} disabled={!editable||!selected.binding?.editableProperties.includes('borderRadius')}/></label><label className="property-label">字号 <span>px</span><input type="number" min="1" max="120" value={properties.fontSize} onChange={e=>editProperty('fontSize',e.target.value)} disabled={!editable||!selected.binding?.editableProperties.includes('fontSize')}/></label></div><label className="property-label">列布局<input value={properties.gridTemplateColumns} placeholder="repeat(2, minmax(0, 1fr))" onChange={e=>editProperty('gridTemplateColumns',e.target.value)} disabled={!editable||!selected.binding?.editableProperties.includes('gridTemplateColumns')}/></label><label className="property-label">间距 <span>px</span><input type="number" min="0" max="200" value={properties.gap} onChange={e=>editProperty('gap',e.target.value)} disabled={!editable||!selected.binding?.editableProperties.includes('gap')}/></label><label className="property-label">背景<input value={properties.background} onChange={e=>editProperty('background',e.target.value)} disabled={!editable||!selected.binding?.editableProperties.includes('background')}/></label><label className="property-label">文字颜色<input value={properties.color} onChange={e=>editProperty('color',e.target.value)} disabled={!editable||!selected.binding?.editableProperties.includes('color')}/></label></div>
          <div className="property-section source-section"><div className="property-title">源码关联<Code2 size={14}/></div>{selected.binding?<><strong>{selected.binding.file}:{selected.binding.line}</strong><small>{selected.binding.scope==='instance'?'当前标记实例':'共享定义 · 影响多个实例'} · 哈希 {short(selected.binding.fileHash)}</small><div className="mapping-check"><ShieldCheck size={12}/>接受前重验文件与运行版本</div></>:<p>尚无可靠映射。可以保存区域建议，自动回写已停用。</p>}</div>
          <div className="change-intent"><label className="property-label">设计意图<textarea value={intent} onChange={e=>setIntent(e.target.value)} placeholder="说明你希望改变什么…" rows={2}/></label><label className="check-label"><input type="checkbox" checked={complexIntent} disabled={!state.capabilities.agent} onChange={e=>setComplexIntent(e.target.checked)}/>通过已配置独立 Codex 执行者修改（批准上限 $1 / 1 轮）</label><button data-testid="prepare-change" className="primary" disabled={!editable||(!complexIntent&&!changedProps.size)||(complexIntent&&!intent.trim())||!!busy} onClick={()=>setUnderstanding(true)}><Sparkles size={15}/>准备修改</button><small>{!isLive?'冻结与候选画板只读；回到实时后创建变更。':!editable?'无可靠映射时仅保留批注。':'先确认理解，再生成隔离候选。'}</small></div>
          {understanding&&<div className="understanding"><span className="eyebrow">修改理解卡</span><h4>{intent||'更新选中控件的属性'}</h4><p>对象：{selected.sourceNodeId}<br/>范围：{selected.binding?.scope==='instance'?'当前标记实例':'共享定义'}<br/>变更：{complexIntent?'交给已授权执行者；仅写入选中控件的候选源码文件；回传后重新审查差异':null}{[...changedProps].map(k=>`${k} → ${properties[k as keyof typeof properties]}`).join('，')}</p><div><ShieldCheck size={13}/>保留点击、数据与键盘行为；验收桌面和窄屏场景。</div><button className="primary" data-testid="confirm-change" disabled={!!busy} onClick={()=>void prepareChange()}>{busy==='prepare'?<Loader2 className="spin" size={15}/>:<Check size={15}/>}确认并生成候选</button></div>}
          </>:<div className="selection-empty"><div className="selection-illustration"><Square size={48} strokeWidth={1}/><MousePointer2 size={24}/></div><h4>从真实界面开始设计</h4><p>在画布上选择控件，检查属性与源码；也可以通过左侧图层定位对象。</p><button className="secondary" onClick={()=>setTab('layers')}><Layers size={14}/>查看控件树</button><div className="quick-start"><span>推荐第一步</span><p>选择「开始监控」按钮，改成「立即开始」，将圆角设为 12。</p></div></div>}
        </>}
        {inspector==='annotations'&&<><div className="panel-heading"><MessageSquare size={18}/><h3>笔迹与批注</h3></div><p className="panel-description">原始表达先保存。文字和笔迹不会自动执行代码。</p><button className="secondary full" onClick={()=>void changeMode('annotate')}><Pencil size={15}/>进入笔迹模式</button><textarea className="note-input" data-testid="annotation-text" placeholder="写下设计意见、约束与验收要求…" value={note} onChange={e=>setNote(e.target.value)} rows={4}/><div className="note-tools"><span>{strokes.length} 条本地笔迹</span><button onClick={()=>setStrokes([])}>清除草稿</button></div><button className="primary full" data-testid="save-annotation" onClick={()=>void saveAnnotation()} disabled={!!busy||!frame}><Check size={15}/>保存批注</button>{outbox.length>0&&<div className="offline-note"><WifiOff size={14}/>{outbox.length} 条已保存在本机，等待同步</div>}<div className="section-label spaced">已保存批注<span>{savedAnnotations.length}</span></div>{savedAnnotations.slice().reverse().map(a=><article className="annotation-card" key={a.id}><div><span className="annotation-number"><MessageSquare size={12}/></span><strong>{a.anchor.type==='object'?'对象批注':'快照批注'}{a.anchor.type==='object'&&!live?.nodes.some(n=>n.runtimeNodeId===a.anchor.runtimeNodeId)?' · 已失联':''}</strong><small>{stamp(a.createdAt)}</small></div><p>{a.text||`${a.strokes.length} 条原始笔迹`}</p><small>{a.strokes.length} 条笔迹 · {a.status==='comment'?'意见已保存':a.status==='resolved'?'已解决':'意图已确认'}</small><button className="text-button" onClick={()=>{const frozen=state.project.snapshots.find(f=>f.id===a.anchor.frameId);if(frozen){setActive(frozen);setReference(null);setLocalDesign(false);}else message('此批注的历史画面未保存，原始笔迹仍可导出');}}>查看锚定快照 <FileImage size={12}/></button>{a.text&&<button className="text-button" onClick={()=>{setIntent(a.text);setIntentAnnotationId(a.id);setActive(null);if(a.anchor.runtimeNodeId)setSelectedId(a.anchor.runtimeNodeId);setInspector('properties');}}>转为修改理解 <ArrowUpRight size={12}/></button>}</article>)}</>}
        {inspector==='tasks'&&<><div className="panel-heading"><GitBranch size={18}/><h3>变更与执行</h3></div><p className="panel-description">候选、验证与接受分别记录，每次操作都绑定实际版本。</p><div className="provider-banner"><Sparkles size={15}/><div><strong>代码提供方</strong><small>{state.providerStatus.agent}</small></div></div>{agentRun&&<div className="agent-run-card"><strong>执行任务 · {agentRun.status}</strong><small>{short(agentRun.id)}</small>{agentRun.logs.slice(-3).map((l,i)=><p key={i}>{l}</p>)}{agentRun.status==='completed'&&<button className="secondary full" onClick={()=>void run('finalize',async()=>{await write(`/agent/runs/${agentRun.id}/finalize`,{changeSetId:agentRun.changeSetId,leaseGeneration:agentRun.lease.generation});await refresh();setAgentRun(null);message('执行结果已汇总，需重新运行候选验证');})}>汇总执行差异</button>}{['submitted','running'].includes(agentRun.status)&&<button className="text-button" onClick={()=>void run('cancel',async()=>{await write(`/agent/runs/${agentRun.id}/cancel`);setAgentRun(r=>r?{...r,status:'cancelled'}:r);})}>取消任务</button>}</div>}{state.changes.length===0?<div className="task-empty"><GitBranch size={30}/><p>还没有修改任务</p><small>从一个映射明确的控件开始，生成最小可审查变更。</small></div>:<><div className="task-list">{state.changes.slice().reverse().map(c=><button data-testid={'change-'+c.id} key={c.id} className={'task-card '+(c.id===change?.id?'active':'')} onClick={()=>{setSelectedChangeId(c.id);setDrawer(true);}}><div><GitBranch size={14}/><small>{short(c.id)}</small><span className={'change-status '+c.status}>{changeNames[c.status]}</span></div><strong>{c.intent}</strong><small>{c.patches.length} 个文件 · {stamp(c.createdAt)}</small></button>)}</div>{change&&<div className="task-actions"><div className="task-checklist">{[['准备隔离候选',true],['实际运行与验证',['verified','accepted','reverted'].includes(change.status)],['人工审查接受',['accepted','reverted'].includes(change.status)]].map(([label,done],i)=><div key={i}>{done?<CheckCircle2 size={14}/>:<Circle size={14}/>}<span>{label}</span></div>)}</div><button className="secondary full" data-testid="verify-change" onClick={()=>void changeAction('verify')} disabled={!!busy||!['prepared','failed','verified'].includes(change.status)}>{busy==='verify'?<Loader2 className="spin" size={15}/>:<Play size={15}/>}运行验证</button>{change.candidateFrame&&<button className="secondary full" onClick={()=>{setCompare(true);setActive(null);setDrawer(true);}}><ArrowLeftRight size={15}/>查看视觉与代码差异</button>}<button className="primary full" data-testid="accept-change" disabled={!!busy||change.status!=='verified'} onClick={()=>void changeAction('apply')}><Check size={15}/>接受此变更</button>{change.status==='accepted'?<button className="secondary full" data-testid="revert-change" disabled={!!busy} onClick={()=>void changeAction('revert')}><Undo2 size={15}/>回退此变更</button>:<button className="text-button full" onClick={()=>void changeAction('discard')} disabled={!!busy||!['prepared','verified','failed'].includes(change.status)}>丢弃候选</button>}<small className="task-footnote">接受仅更新授权项目；推送与部署需要独立操作。</small></div>}</>}</>}
        </div><div className="inspector-footer"><ShieldCheck size={13}/><span>本地授权工作区 · 生产默认只读</span></div>
      </aside>
    </div>
    {toast&&<div className="toast" role="status"><Activity size={16}/><span>{toast}</span><button onClick={()=>setToast('')}><X size={14}/></button></div>}
    {pairing&&<div className="modal-backdrop"><div className="pair-modal"><button className="modal-close" onClick={()=>setPairing(false)} aria-label="关闭配对"><X size={18}/></button><div className="auth-icon"><Link2 size={28}/></div><h2>让 iPad 加入同一工作区</h2><p>在可信设备上打开 Bridge 工作台并输入此码。</p><div className="pair-code" data-testid="pairing-code">{pairCode||'生成中…'}</div><small>{pairExpires?'有效至 '+stamp(pairExpires)+' · 仅可使用一次':'短期有效、可随时撤销'}</small><div className="pair-address"><code>{location.origin}</code><button title="复制地址" onClick={()=>void navigator.clipboard.writeText(location.origin).then(()=>message('工作台地址已复制'))}><Copy size={14}/></button></div><p className="pair-network-note">本机模式需先配置可信局域网 HTTPS 入口，iPad 不能连接电脑的 localhost。</p>{state.devices.map(d=><div className="device-row" key={d.id}><Smartphone size={16}/><span>{d.name}</span><button onClick={()=>void run('revoke',async()=>{await write(`/devices/${d.id}/revoke`);await refresh();})}>撤销</button></div>)}</div></div>}
    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e=>{if(e.target.files?.[0])void uploadAsset(e.target.files[0]);e.target.value='';}}/>
    <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={e=>{if(e.target.files?.[0])void importProject(e.target.files[0]);e.target.value='';}}/>
  </div>;
}
function Brand(){return <div className="brand"><div className="brand-mark"><span/><span/><span/></div><strong>R-Design</strong></div>;}
function simpleDiff(before:string,after:string){const a=before.split('\n'),b=after.split('\n');const start=a.findIndex((line,i)=>line!==b[i]);if(start<0)return '无源码差异';const from=Math.max(0,start-2);let endA=a.length-1,endB=b.length-1;while(endA>start&&endB>start&&a[endA]===b[endB]){endA--;endB--;}return a.slice(from,start).map(l=>'  '+l).concat(a.slice(start,endA+1).map(l=>'− '+l),b.slice(start,endB+1).map(l=>'+ '+l),b.slice(endB+1,endB+3).map(l=>'  '+l)).join('\n');}
function DesignBoard({onSave,initialNodes}:{initialNodes?:Project['designFrames'][number]['nodes'];onSave:(nodes:Project['designFrames'][number]['nodes'])=>Promise<void>}){
  const [nodes,setNodes]=useState<Project['designFrames'][number]['nodes']>(initialNodes||[]);
  const [text,setText]=useState('设计标题');
  return <div className="design-board"><div className="design-tools"><input value={text} onChange={e=>setText(e.target.value)}/><button onClick={()=>setNodes(n=>[...n,{id:crypto.randomUUID(),type:'text',bounds:{x:60,y:60+n.length*70,w:400,h:50},text,color:'#203b37'}])}><Plus size={13}/>文字节点</button><button onClick={()=>setNodes(n=>[...n,{id:crypto.randomUUID(),type:'rectangle',bounds:{x:60,y:60+n.length*70,w:300,h:54},color:'#c9e7dc'}])}><Square size={13}/>矩形</button><button onClick={()=>void onSave(nodes)}><Check size={13}/>保存画板</button></div><svg viewBox="0 0 780 600">{nodes.map(n=>n.type==='text'?<text key={n.id} x={n.bounds.x} y={n.bounds.y+30} fill={n.color} fontSize="26">{n.text}</text>:<rect key={n.id} x={n.bounds.x} y={n.bounds.y} width={n.bounds.w} height={n.bounds.h} fill={n.color} rx="12"/>)}</svg>{!nodes.length&&<div className="design-empty"><Layers size={30}/><p>用真实节点构建设计</p><small>设计文档保存为结构化对象，与运行画面独立。</small></div>}</div>;
}
