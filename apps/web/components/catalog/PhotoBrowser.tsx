'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, X, ZoomIn, ZoomOut } from 'lucide-react';
import { ShareLinkButton } from './ShareLinkButton';
import { FavoriteToggle, type FavoriteSnapshot } from './FavoriteToggle';
import { retryProtectedPhoto } from './protected-photo-retry';
import styles from './PhotoBrowser.module.css';
export function PhotoBrowser({images,title,initialIndex=0,offerId,snapshot,onClose}:{images:string[];title:string;initialIndex?:number;offerId?:string;snapshot?:FavoriteSnapshot;onClose:()=>void}) {
 const dialog=useRef<HTMLDialogElement>(null),viewport=useRef<HTMLDivElement>(null),tiles=useRef<HTMLDivElement>(null);
 const [selected,setSelected]=useState<number|null>(null),[scale,setScale]=useState(1),[pan,setPan]=useState({x:0,y:0});
 const gesture=useRef({scale:1,pan:{x:0,y:0}}),pointers=useRef(new Map<number,{x:number;y:number}>());
 const swiped=useRef(false);
 const start=useRef({distance:0,scale:1,x:0,y:0,pan:{x:0,y:0}});
 function zoom(value:number){const next=Math.max(1,Math.min(4,value));gesture.current.scale=next;setScale(next);if(next===1){gesture.current.pan={x:0,y:0};setPan({x:0,y:0});}}
 function open(index:number){zoom(1);pointers.current.clear();setSelected(index);}
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';dialog.current?.showModal();
  const tile=tiles.current?.querySelector<HTMLElement>(`[data-photo-index="${initialIndex}"]`);tile?.scrollIntoView({block:'center'});
  return ()=>{document.body.style.overflow=overflow;previous?.focus({preventScroll:true});};
 },[]);
 useEffect(()=>{
  const element=viewport.current;if(!element||selected===null)return;
  const wheel=(event:WheelEvent)=>{event.preventDefault();zoom(gesture.current.scale+(event.deltaY<0?.25:-.25));};
  element.addEventListener('wheel',wheel,{passive:false});return ()=>element.removeEventListener('wheel',wheel);
 },[selected]);
 function begin(event:React.PointerEvent<HTMLDivElement>){
  if(event.pointerType==='mouse'&&event.button!==0)return;
  event.preventDefault();swiped.current=pointers.current.size>0;event.currentTarget.setPointerCapture(event.pointerId);pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY});
  const points=[...pointers.current.values()];start.current={distance:points.length===2?Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y):0,scale:gesture.current.scale,x:event.clientX,y:event.clientY,pan:{...gesture.current.pan}};
 }
 function move(event:React.PointerEvent<HTMLDivElement>){
  if(!pointers.current.has(event.pointerId))return;pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY});
  const points=[...pointers.current.values()];
  if(points.length===2&&start.current.distance){zoom(start.current.scale*Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y)/start.current.distance);return;}
  if(points.length===1&&gesture.current.scale>1){const rect=event.currentTarget.getBoundingClientRect(),limitX=rect.width*(gesture.current.scale-1)/2,limitY=rect.height*(gesture.current.scale-1)/2;
   const value={x:Math.max(-limitX,Math.min(limitX,start.current.pan.x+event.clientX-start.current.x)),y:Math.max(-limitY,Math.min(limitY,start.current.pan.y+event.clientY-start.current.y))};gesture.current.pan=value;setPan(value);}
 }
 function end(event:React.PointerEvent<HTMLDivElement>){const dx=event.clientX-start.current.x,dy=event.clientY-start.current.y;const swipe=event.type!=='pointercancel'&&!swiped.current&&pointers.current.size===1&&gesture.current.scale===1&&Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.5; pointers.current.delete(event.pointerId);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);if(swipe&&selected!==null){open((selected+(dx<0?1:images.length-1))%images.length);return;}const point=[...pointers.current.values()][0];if(point)start.current={distance:0,scale:gesture.current.scale,x:point.x,y:point.y,pan:{...gesture.current.pan}};}
 return <dialog ref={dialog} className={styles.dialog} aria-label={`Фотографии ${title}`} onClose={onClose} onCancel={event=>{event.preventDefault();if(selected!==null){zoom(1);setSelected(null)}else onClose()}} onKeyDown={event=>{if(selected===null)return;if(event.key==='ArrowRight'){event.preventDefault();open((selected+1)%images.length)}if(event.key==='ArrowLeft'){event.preventDefault();open((selected+images.length-1)%images.length)}}}>
  <header className={styles.header}>
   <button type="button" autoFocus className={styles.control} onClick={()=>{if(selected!==null){zoom(1);setSelected(null)}else onClose()}} aria-label={selected===null?'Закрыть галерею':'Ко всем фотографиям'}>{selected===null?<X/>:<ArrowLeft/>}</button>
   <div className={styles.title}>{title}<span>{selected===null?`${images.length} фото`:`${selected+1} / ${images.length}`}</span></div>
   {offerId?<FavoriteToggle offerId={offerId} snapshot={snapshot} compact/>:null}
   <ShareLinkButton iconOnly className={styles.control}/>
   {selected!==null?<button type="button" onClick={onClose} className={styles.control} aria-label="Закрыть галерею"><X/></button>:null}
  </header>
  <div ref={tiles} className={styles.tiles} hidden={selected!==null}>
   {images.map((src,index)=><button type="button" data-photo-index={index} key={src} className={styles.tile} onClick={()=>open(index)} aria-label={`Увеличить фото ${index+1}`}><img src={src} alt={`${title}, фото ${index+1}`} loading={index===initialIndex?'eager':'lazy'} decoding="async" draggable={false} onError={retryProtectedPhoto}/></button>)}
  </div>
  {selected!==null?<>
   <div ref={viewport} className={styles.viewport} onDragStart={e=>e.preventDefault()} onContextMenu={e=>e.preventDefault()} onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onDoubleClick={()=>zoom(scale===1?2:1)}>
    <img data-zoom-image src={images[selected]} alt={`${title}, фото ${selected+1}`} style={{transform:`translate(${pan.x}px,${pan.y}px) scale(${scale})`}} draggable={false} onError={retryProtectedPhoto}/>
   </div>
   <div className={styles.zoom}>
    <button type="button" className={styles.control} onClick={()=>open((selected+images.length-1)%images.length)} aria-label="Предыдущее фото">←</button>
    <button type="button" className={styles.control} onClick={()=>zoom(scale-.5)} disabled={scale===1} aria-label="Уменьшить фото"><ZoomOut/></button>
    <button type="button" className={styles.percent} onClick={()=>zoom(1)} aria-label="Сбросить масштаб">{Math.round(scale*100)}%</button>
    <button type="button" className={styles.control} onClick={()=>zoom(scale+.5)} disabled={scale===4} aria-label="Увеличить фото"><ZoomIn/></button>
    <button type="button" className={styles.control} onClick={()=>open((selected+1)%images.length)} aria-label="Следующее фото">→</button>
   </div>
  </>:null}
 </dialog>;
}
