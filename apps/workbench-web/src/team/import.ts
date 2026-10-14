import type { TeamEvidence, TeamLayer } from '../../../../packages/team-protocol/src/index';
export interface ImportedDesign { id:string; title:string; summary:string; imageDataUrl:string; layers:TeamLayer[]; diff:string; evidence:TeamEvidence[] }
type RecordValue=Record<string,unknown>;
const record=(value:unknown):RecordValue=>value&&typeof value==='object'&&!Array.isArray(value)?value as RecordValue:{};
const text=(value:unknown,limit=2000)=>typeof value==='string'?value.slice(0,limit):'';
const list=(value:unknown)=>Array.isArray(value)?value:[];
function layersOf(value:unknown):TeamLayer[] {
  return list(value).slice(0,500).flatMap(item=>{
    const node=record(item),bounds=record(node.bounds);const {x,y,w,h}=bounds;
    if(![x,y,w,h].every(v=>typeof v==='number'&&Number.isFinite(v))||Number(w)<0||Number(h)<0)return [];
    const id=text(node.runtimeNodeId||node.id,128);if(!id)return [];
    return [{id,name:text(node.text||node.name||node.sourceNodeId||node.tag||id,160),bounds:{x:Number(x),y:Number(y),w:Number(w),h:Number(h)}}];
  });
}
/** Extract review evidence only. sourceFiles, tooling and provider configuration are never returned. */
export function parseEngineeringEvidence(input:unknown):ImportedDesign[] {
  const bundle=record(input);if(bundle.schemaVersion!==1)throw new Error('不支持的工程格式，请使用 schemaVersion 1 的 R-Design 导出。');
  const document=bundle.document?record(bundle.document):bundle;
  if(document.schemaVersion!==1)throw new Error('工程文档格式无效。');
  const project=record(document.project);const result:ImportedDesign[]=[];const seen=new Set<string>();
  const add=(raw:unknown,change?:RecordValue)=>{
    const frame=record(raw);const image=text(frame.image,16*1024*1024);
    if(!['snapshot','candidate'].includes(String(frame.kind))||!['frozen','stale'].includes(String(frame.status))||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image))return;
    const id=text(frame.id,128);if(!id||seen.has(id))return;
    const width=Number(frame.width),height=Number(frame.height);if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0)return;
    seen.add(id);
    const diff=change?list(change.patches).slice(0,50).map(item=>{const patch=record(item);return `--- ${text(patch.file,300)} (基准)\n+++ ${text(patch.file,300)} (候选)\n${text(patch.before,40000).split('\n').map(line=>'- '+line).join('\n')}\n${text(patch.after,40000).split('\n').map(line=>'+ '+line).join('\n')}`;}).join('\n\n').slice(0,60000):'';
    const evidence=change?list(change.evidence).slice(0,100).flatMap(item=>{const e=record(item);return typeof e.passed==='boolean'?[{name:text(e.name,160),passed:e.passed,detail:text(e.detail,4000)}]:[];}):[];
    result.push({id,title:text(change?.intent,200)||`${text(project.name,100)||'设计'} · 快照 ${result.length+1}`,summary:change?text(change.intent,2000):`导入冻结画面${text(frame.timestamp)?` · ${text(frame.timestamp,100)}`:''}${text(frame.codeRevision)?`\n源码版本 ${text(frame.codeRevision,100)}`:''}`,imageDataUrl:image,layers:layersOf(frame.nodes),diff,evidence});
  };
  for(const snapshot of list(project.snapshots))add(snapshot);
  for(const raw of list(document.changes)){const change=record(raw);if(change.candidateFrame)add(change.candidateFrame,change);}
  if(!result.length)throw new Error('工程没有可审阅的冻结截图或候选截图。请先在工作台保存快照或运行候选验证，再导出工程。');
  return result;
}
