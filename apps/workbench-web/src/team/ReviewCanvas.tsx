import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Hand, Maximize2, MousePointer2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import type { TeamVersion } from '../../../../packages/team-protocol/src/index';

export type CompareMode='current'|'previous'|'side';
export function ReviewCanvas({version,previous,compareMode,selectedLayer,onSelect}:{version:TeamVersion;previous?:TeamVersion;compareMode:CompareMode;selectedLayer:string;onSelect:(id:string)=>void}){
  const viewport=useRef<HTMLDivElement>(null);
  const [camera,setCamera]=useState({x:0,y:0,zoom:1});
  const [hand,setHand]=useState(false);
  const [dragging,setDragging]=useState(false);
  const drag=useRef<{pointer:number;x:number;y:number;cx:number;cy:number}|null>(null);
  const shown=compareMode==='previous'&&previous?previous:version;
  const side=compareMode==='side'&&!!previous;
  const gap=96;
  const worldWidth=side?previous!.width+gap+version.width:shown.width;
  const worldHeight=(side?Math.max(previous!.height,version.height):shown.height)+42;
  const fit=useCallback(()=>{
    const box=viewport.current?.getBoundingClientRect();if(!box)return;
    const zoom=Math.min(1,Math.max(.005,Math.min((box.width-96)/worldWidth,(box.height-110)/worldHeight)));
    setCamera({zoom,x:(box.width-worldWidth*zoom)/2,y:(box.height-worldHeight*zoom)/2});
  },[worldWidth,worldHeight]);
  const zoomAt=useCallback((factor:number,point?:{x:number;y:number})=>{
    const box=viewport.current?.getBoundingClientRect();if(!box)return;
    const p=point??{x:box.width/2,y:box.height/2};
    setCamera(c=>{const zoom=Math.min(8,Math.max(.005,c.zoom*factor)),ratio=zoom/c.zoom;return {zoom,x:p.x-(p.x-c.x)*ratio,y:p.y-(p.y-c.y)*ratio};});
  },[]);
  useEffect(()=>{
    fit();const observer=new ResizeObserver(()=>fit());if(viewport.current)observer.observe(viewport.current);return ()=>observer.disconnect();
  },[version.id,previous?.id,compareMode,fit]);
  useEffect(()=>{
    const element=viewport.current;if(!element)return;
    const wheel=(event:WheelEvent)=>{event.preventDefault();if(event.ctrlKey||event.metaKey){const box=element.getBoundingClientRect();zoomAt(Math.exp(-event.deltaY*.002),{x:event.clientX-box.left,y:event.clientY-box.top});}else setCamera(c=>({...c,x:c.x-event.deltaX,y:c.y-event.deltaY}));};
    element.addEventListener('wheel',wheel,{passive:false});return ()=>element.removeEventListener('wheel',wheel);
  },[zoomAt]);
  const board=(item:TeamVersion,x:number,label:string,interactive:boolean)=><div className="team-artboard" style={{left:x,width:item.width}} key={item.id}>
    <div className="team-artboard-caption"><strong>{label}</strong><span>V{item.number} · {item.title}</span></div>
    <div className="team-artboard-image" style={{width:item.width,height:item.height}}>
      <img src={item.imageDataUrl} width={item.width} height={item.height} alt={`${item.title}，版本 ${item.number}`} draggable={false}/>
      {interactive&&item.layers.map(layer=><button key={layer.id} className={`team-layer-hit ${selectedLayer===layer.id?'is-selected':''}`} aria-label={`选择图层 ${layer.name}`} title={layer.name} style={{left:layer.bounds.x,top:layer.bounds.y,width:Math.max(1,layer.bounds.w),height:Math.max(1,layer.bounds.h)}} onPointerDown={event=>{if(!hand){event.stopPropagation();onSelect(layer.id);}}} onClick={event=>{event.stopPropagation();if(!hand)onSelect(layer.id);}} tabIndex={-1}>{selectedLayer===layer.id&&<span>{layer.name}</span>}</button>)}
    </div>
  </div>;
  return <div className={`team-canvas ${dragging?'is-dragging':''} ${hand?'is-hand':''}`} ref={viewport} tabIndex={0} aria-label="设计审阅画布，拖动平移，Ctrl 加滚轮缩放" onKeyDown={event=>{if(event.key==='+'||event.key==='='){event.preventDefault();zoomAt(1.2);}else if(event.key==='-'){event.preventDefault();zoomAt(1/1.2);}else if(event.key.toLowerCase()==='f'){event.preventDefault();fit();}else if(event.key==='0'){event.preventDefault();const box=viewport.current?.getBoundingClientRect();if(box)setCamera({zoom:1,x:(box.width-worldWidth)/2,y:(box.height-worldHeight)/2});}}}
    onPointerDown={event=>{if(event.button!==0&&event.button!==1)return;const target=event.target as HTMLElement;if(target.closest('.team-canvas-tools'))return;viewport.current?.setPointerCapture(event.pointerId);drag.current={pointer:event.pointerId,x:event.clientX,y:event.clientY,cx:camera.x,cy:camera.y};setDragging(true);}}
    onPointerMove={event=>{const start=drag.current;if(start?.pointer===event.pointerId)setCamera(c=>({...c,x:start.cx+event.clientX-start.x,y:start.cy+event.clientY-start.y}));}}
    onPointerUp={event=>{if(drag.current?.pointer===event.pointerId){drag.current=null;setDragging(false);viewport.current?.releasePointerCapture(event.pointerId);}}}
    onPointerCancel={()=>{drag.current=null;setDragging(false);}}>
    <div className="team-canvas-world" style={{transform:`translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`}}>
      {side?<>{board(previous!,0,'基准版本',false)}{board(version,previous!.width+gap,'当前版本',true)}</>:board(shown,0,compareMode==='previous'?'基准版本':'当前版本',compareMode!=='previous')}
    </div>
    <div className="team-canvas-watermark"><ArrowLeftRight size={14}/><span>{side?'并排比较 · 原始尺寸':compareMode==='previous'?'正在查看基准版本':'冻结设计证据 · 内容只读'}</span></div>
    <div className="team-canvas-tools" onPointerDown={event=>event.stopPropagation()}>
      <button aria-label="选择图层工具" aria-pressed={!hand} className={!hand?'active':''} onClick={()=>setHand(false)}><MousePointer2 size={17}/></button>
      <button aria-label="手形平移工具" aria-pressed={hand} className={hand?'active':''} onClick={()=>setHand(true)}><Hand size={17}/></button>
      <i/>
      <button aria-label="缩小画布" onClick={()=>zoomAt(1/1.2)}><ZoomOut size={17}/></button><span>{Math.round(camera.zoom*100)}%</span><button aria-label="放大画布" onClick={()=>zoomAt(1.2)}><ZoomIn size={17}/></button>
      <i/>
      <button aria-label="适合全部画板" title="适合画板 (F)" onClick={fit}><Maximize2 size={17}/></button>
      <button aria-label="恢复实际尺寸" title="实际尺寸 (0)" onClick={()=>{const box=viewport.current?.getBoundingClientRect();if(box)setCamera({zoom:1,x:(box.width-worldWidth)/2,y:(box.height-worldHeight)/2});}}><RotateCcw size={16}/></button>
    </div>
  </div>;
}
