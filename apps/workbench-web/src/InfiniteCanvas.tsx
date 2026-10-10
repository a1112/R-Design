import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { Hand, Move, MousePointer2 } from 'lucide-react';
import { fitCamera, panCamera, zoomCameraAt, type Camera } from '../../../packages/canvas-core/src/index';
import type { Bounds, Mode } from '../../../packages/protocol/src/index';

export interface CanvasNavigation {
  fit(): void;
  zoomTo(zoom: number): void;
  zoomIn(): void;
  zoomOut(): void;
  camera(): Camera;
  viewport(): DOMRect | undefined;
}
interface Props {
  bounds: Bounds;
  contentKey: string;
  hand: boolean;
  mode: Mode;
  onHandChange(hand: boolean): void;
  onSelect(): void;
  onCameraChange(camera: Camera): void;
  onNavigationStart(): void;
  onSpaceTap?(): void;
  onSpaceChange?(active:boolean): void;
  children: ReactNode;
  overlay?: ReactNode;
}
const typing = (target: EventTarget | null) => target instanceof Element && !!target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"]');

export const InfiniteCanvas = forwardRef<CanvasNavigation, Props>(function InfiniteCanvas(props, ref) {
  const { bounds, contentKey, hand, mode, onHandChange, onSelect, onCameraChange, onNavigationStart, children, overlay } = props;
  const element = useRef<HTMLDivElement>(null);
  const current = useRef(props); current.current = props;
  const [camera, setCamera] = useState<Camera>({x: 48, y: 48, zoom: 1});
  const cameraRef = useRef(camera); cameraRef.current = camera;
  const autoFit = useRef(true);
  const size = useRef({width: 0, height: 0});
  const [space, setSpace] = useState(false);
  const spaceRef = useRef(false);
  const spaceDragged = useRef(false);
  const [panning, setPanning] = useState(false);
  const drag = useRef<{id:number;x:number;y:number} | null>(null);
  const touches = useRef(new Map<number, {x:number;y:number}>());
  const touchOrigin = useRef<{id:number;x:number;y:number}|null>(null);
  const pinch = useRef<{distance:number;mid:{x:number;y:number}} | null>(null);
  const gesture = useRef(false);

  function update(next: Camera, manual = true) {
    if (manual) autoFit.current = false;
    cameraRef.current = next;
    setCamera(next);
    current.current.onCameraChange(next);
  }
  function fit() {
    const el = element.current; if (!el?.clientWidth || !el.clientHeight) return;
    autoFit.current = true;
    update(fitCamera(current.current.bounds, {width: el.clientWidth, height: el.clientHeight}, el.clientWidth < 650 ? 24 : 48), false);
  }
  function zoomTo(scale: number) {
    const el = element.current; if (!el) return;
    update(zoomCameraAt(cameraRef.current, {x:el.clientWidth/2,y:el.clientHeight/2}, scale));
  }
  useImperativeHandle(ref, () => ({ fit, zoomTo, zoomIn:()=>zoomTo(cameraRef.current.zoom*1.2), zoomOut:()=>zoomTo(cameraRef.current.zoom/1.2), camera:()=>cameraRef.current, viewport:()=>element.current?.getBoundingClientRect() }), []);
  useLayoutEffect(() => {
    const el = element.current; if (!el) return;
    const resize = () => {
      const next = {width:el.clientWidth,height:el.clientHeight};
      if (!next.width || !next.height) return;
      if (autoFit.current) fit();
      else if (size.current.width && size.current.height) update(panCamera(cameraRef.current, {x:(next.width-size.current.width)/2,y:(next.height-size.current.height)/2}), false);
      size.current = next;
    };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => { fit(); }, [contentKey, bounds.x, bounds.y, bounds.w, bounds.h]);

  useEffect(() => {
    const el = element.current; if (!el) return;
    const wheel = (event: WheelEvent) => {
      if (typing(event.target)) return;
      const state = current.current;
      // Explicit interaction keeps source scrolling; camera gestures always take precedence.
      if (!event.ctrlKey && !event.metaKey && state.mode === 'interact' && !state.hand && !spaceRef.current) return;
      event.preventDefault(); event.stopPropagation();if(spaceRef.current)spaceDragged.current=true;
      const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientHeight : 1;
      if (event.ctrlKey || event.metaKey) {
        const rect = el.getBoundingClientRect();
        update(zoomCameraAt(cameraRef.current, {x:event.clientX-rect.left,y:event.clientY-rect.top}, cameraRef.current.zoom*Math.exp(-event.deltaY*multiplier*0.008)));
      } else {
        const x = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
        const y = event.shiftKey && !event.deltaX ? 0 : event.deltaY;
        update(panCamera(cameraRef.current, {x:-x*multiplier,y:-y*multiplier}));
      }
    };
    el.addEventListener('wheel', wheel, {passive:false,capture:true});
    return () => el.removeEventListener('wheel', wheel, {capture:true});
  }, []);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (typing(event.target) || event.isComposing) return;
      if (event.code === 'Space') {event.preventDefault();event.stopPropagation();if(!spaceRef.current)spaceDragged.current=false;spaceRef.current=true;setSpace(true);current.current.onSpaceChange?.(true);return;}
      if((event.ctrlKey||event.metaKey)&&['+','=','-','_','0'].includes(event.key)){event.preventDefault();event.stopPropagation();zoomTo(event.key==='0'?1:cameraRef.current.zoom*(event.key==='-'||event.key==='_'?1/1.2:1.2));return;}
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (current.current.mode==='interact'&&!current.current.hand&&!event.shiftKey)return;
      if (event.key.toLowerCase() === 'h') {event.preventDefault();event.stopPropagation();current.current.onHandChange(true);}
      else if (event.key.toLowerCase() === 'v') {event.preventDefault();event.stopPropagation();current.current.onHandChange(false);current.current.onSelect();}
      else if ((event.code === 'Digit1' || event.key === '1') && event.shiftKey) {event.preventDefault();event.stopPropagation();fit();}
      else if ((event.code === 'Digit0' || event.key === '0') && event.shiftKey) {event.preventDefault();event.stopPropagation();zoomTo(1);}
      else if (event.key === '+' || event.key === '=') {event.preventDefault();event.stopPropagation();zoomTo(cameraRef.current.zoom*1.2);}
      else if (event.key === '-' || event.key === '_') {event.preventDefault();event.stopPropagation();zoomTo(cameraRef.current.zoom/1.2);}
    };
    const up = (event:KeyboardEvent) => {if(event.code==='Space'&&spaceRef.current){event.preventDefault();event.stopPropagation();spaceRef.current=false;setSpace(false);current.current.onSpaceChange?.(false);if(!spaceDragged.current)current.current.onSpaceTap?.();}};
    const blur = () => {spaceRef.current=false;setSpace(false);current.current.onSpaceChange?.(false);drag.current=null;touches.current.clear();pinch.current=null;gesture.current=false;setPanning(false);};
    window.addEventListener('keydown',down,true);window.addEventListener('keyup',up,true);window.addEventListener('blur',blur);
    return()=>{window.removeEventListener('keydown',down,true);window.removeEventListener('keyup',up,true);window.removeEventListener('blur',blur);};
  }, []);

  function point(event: {clientX:number;clientY:number}) {
    const rect=element.current!.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top};
  }
  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (typing(event.target) || event.target instanceof Element && event.target.closest('button,a')) return;
    if (event.pointerType === 'touch'){touches.current.set(event.pointerId, point(event));if(touches.current.size===1)touchOrigin.current={id:event.pointerId,x:event.clientX,y:event.clientY};}
    if (touches.current.size === 2) {
      event.preventDefault();event.stopPropagation();onNavigationStart();drag.current=null;gesture.current=true;setPanning(true);
      const [a,b]=[...touches.current.values()];pinch.current={distance:Math.hypot(a.x-b.x,a.y-b.y),mid:{x:(a.x+b.x)/2,y:(a.y+b.y)/2}};
      for(const id of touches.current.keys())try{event.currentTarget.setPointerCapture(id);}catch{}
      return;
    }
    const blank=event.target===event.currentTarget || event.target instanceof Element && (event.target.matches('[data-canvas-background]') || !!event.target.closest('.artboard-label,.artboard-footer'));
    if (event.button===1 || hand || spaceRef.current || blank && event.button===0) {
      event.preventDefault();event.stopPropagation();if(spaceRef.current)spaceDragged.current=true;onNavigationStart();gesture.current=true;
      drag.current={id:event.pointerId,x:event.clientX,y:event.clientY};setPanning(true);event.currentTarget.setPointerCapture(event.pointerId);
    }
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    if(touches.current.has(event.pointerId))touches.current.set(event.pointerId,point(event));
    if(!gesture.current&&event.pointerType==='touch'&&touches.current.size===1&&mode!=='annotate'&&mode!=='interact'&&touchOrigin.current?.id===event.pointerId&&Math.hypot(event.clientX-touchOrigin.current.x,event.clientY-touchOrigin.current.y)>6){event.preventDefault();event.stopPropagation();onNavigationStart();gesture.current=true;drag.current={id:event.pointerId,x:touchOrigin.current.x,y:touchOrigin.current.y};setPanning(true);event.currentTarget.setPointerCapture(event.pointerId);}
    if(pinch.current && touches.current.size>=2){
      event.preventDefault();event.stopPropagation();const [a,b]=[...touches.current.values()];const distance=Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      update(panCamera(zoomCameraAt(cameraRef.current,pinch.current.mid,cameraRef.current.zoom*distance/Math.max(1,pinch.current.distance)),{x:mid.x-pinch.current.mid.x,y:mid.y-pinch.current.mid.y}));pinch.current={distance,mid};return;
    }
    if(drag.current?.id===event.pointerId){event.preventDefault();event.stopPropagation();update(panCamera(cameraRef.current,{x:event.clientX-drag.current.x,y:event.clientY-drag.current.y}));drag.current={id:event.pointerId,x:event.clientX,y:event.clientY};}
  }
  function up(event: ReactPointerEvent<HTMLDivElement>) {
    touches.current.delete(event.pointerId);
    if(gesture.current){event.preventDefault();event.stopPropagation();}
    if(drag.current?.id===event.pointerId)drag.current=null;
    if(touches.current.size<2)pinch.current=null;
    if(!touches.current.size&&!drag.current){gesture.current=false;touchOrigin.current=null;setPanning(false);}
    try{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}catch{}
  }
  const pitch=Math.max(8,32*camera.zoom);
  const style:CSSProperties={backgroundSize:`${pitch}px ${pitch}px`,backgroundPosition:`${camera.x%pitch}px ${camera.y%pitch}px`};
  return <div ref={element} className={`infinite-viewport ${hand||space?'is-space':''} ${panning?'is-panning':''}`} data-testid="infinite-viewport" tabIndex={-1} data-camera-x={camera.x} data-camera-y={camera.y} data-camera-zoom={camera.zoom} style={style} onPointerDownCapture={down} onPointerMoveCapture={move} onPointerUpCapture={up} onPointerCancelCapture={up} onContextMenu={e=>{if(panning)e.preventDefault();}}>
    <div className="canvas-world" data-testid="canvas-world" style={{transform:`translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`}}>{children}</div>
    {overlay}
    <div className="canvas-navigation-hint" aria-hidden="true">{hand||space?<Hand size={12}/>:<Move size={12}/>}<span>{hand?'拖动平移 · V 选择':'空格 + 拖动平移'} · ⌘ / Ctrl + 滚轮缩放</span></div>
  </div>;
});
