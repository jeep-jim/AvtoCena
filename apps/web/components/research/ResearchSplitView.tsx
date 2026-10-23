"use client";

import {useEffect, useId, useRef, useState, type ReactNode, type PointerEvent, type KeyboardEvent} from 'react';
import './ResearchSplitView.css';

const MIN_PANEL=320, MAX_PANEL=720, MIN_PAGE=580, MOBILE_AT=960;
const WIDTH_KEY='avtocena.research-panel-width.v1';

/** Presentation only. A panel slot must contain an authorized embed or our own chat. */
export function ResearchSplitView({open,onClose,children,panel,title='Уточнить с ИИ'}:{
  open:boolean;onClose:()=>void;children:ReactNode;panel:ReactNode;title?:string;
}) {
  const root=useRef<HTMLDivElement>(null), closeButton=useRef<HTMLButtonElement>(null);
  const panelId=useId(), headingId=useId();
  const [width,setWidth]=useState(420), [available,setAvailable]=useState(1440), [dragging,setDragging]=useState(false);
  const drag=useRef<{x:number;width:number}|null>(null);
  const max=Math.max(MIN_PANEL,Math.min(MAX_PANEL,available-MIN_PAGE));
  const effective=Math.min(max,Math.max(MIN_PANEL,width));
  const mobile=available<MOBILE_AT;
  const closeRef=useRef(onClose);closeRef.current=onClose;
  useEffect(()=>{
    try {const saved=Number(localStorage.getItem(WIDTH_KEY));if(Number.isFinite(saved)&&saved>=MIN_PANEL)setWidth(Math.min(MAX_PANEL,saved));}catch{}
    const observer=new ResizeObserver(entries=>setAvailable(entries[0].contentRect.width));
    if(root.current)observer.observe(root.current);
    return ()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    if(!open)return;
    const prior=document.activeElement instanceof HTMLElement?document.activeElement:null;
    closeButton.current?.focus({preventScroll:true});
    const escape=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();closeRef.current();}};
    root.current?.addEventListener('keydown',escape);
    const element=root.current;
    return ()=>{element?.removeEventListener('keydown',escape);if(prior?.isConnected)prior.focus({preventScroll:true});};
  },[open]);
  function change(next:number) {
    const value=Math.round(Math.min(max,Math.max(MIN_PANEL,next)));
    setWidth(value);try{localStorage.setItem(WIDTH_KEY,String(value));}catch{}
  }
  function start(event:PointerEvent<HTMLDivElement>) {
    if(!event.isPrimary||event.button!==0||mobile)return;
    event.preventDefault();event.currentTarget.focus();
    drag.current={x:event.clientX,width:effective};setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event:PointerEvent<HTMLDivElement>) {
    if(drag.current)change(drag.current.width+drag.current.x-event.clientX);
  }
  function stop(){drag.current=null;setDragging(false);}
  function keyboard(event:KeyboardEvent<HTMLDivElement>) {
    const next=event.key==='ArrowLeft'?effective+24:event.key==='ArrowRight'?effective-24:event.key==='Home'?MIN_PANEL:event.key==='End'?max:null;
    if(next!==null){event.preventDefault();change(next);}
  }
  return <div ref={root} className={`ac-research-split ${open?'is-open':''} ${dragging?'is-dragging':''} ${mobile?'is-mobile':''}`}
    style={{'--research-width':`${effective}px`} as React.CSSProperties}>
    <div className="ac-research-page" aria-hidden={open&&mobile?true:undefined}>{children}</div>
    {open&&<>
      <div role="separator" aria-label="Изменить ширину чата" aria-orientation="vertical" aria-controls={panelId}
        aria-valuemin={MIN_PANEL} aria-valuemax={max} aria-valuenow={effective} aria-valuetext={`${effective} пикселей`}
        tabIndex={mobile?-1:0} className="ac-research-divider" onPointerDown={start} onPointerMove={move}
        onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} onKeyDown={keyboard} onDoubleClick={()=>change(420)}><span/></div>
      <aside id={panelId} aria-labelledby={headingId} className="ac-research-panel">
        <header className="ac-research-panel-header"><span className="ac-research-mark" aria-hidden="true">✦</span><h2 id={headingId}>{title}</h2>
          <button ref={closeButton} type="button" onClick={onClose} aria-label="Закрыть панель ИИ">×</button></header>
        <div className="ac-research-panel-content">{panel}</div>
      </aside>
    </>}
  </div>;
}
