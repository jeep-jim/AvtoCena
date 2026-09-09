"use client";
import { useEffect, useRef, type ReactNode } from "react";

/** A tall sidebar can scroll to its bottom before sticking; no nested scrollbar. */
export function StickyOfferColumn({children}:{children:ReactNode}) {
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const node=ref.current;
  if(!node)return;
  const update=()=>node.style.setProperty('--offer-sticky-top',`${Math.min(92,window.innerHeight-node.getBoundingClientRect().height-24)}px`);
  const observer=new ResizeObserver(update);
  observer.observe(node);
  window.addEventListener('resize',update);
  update();
  return ()=>{observer.disconnect();window.removeEventListener('resize',update);};
 },[]);
 return <div ref={ref} className="min-w-0 xl:sticky xl:top-[var(--offer-sticky-top,92px)] xl:self-start">{children}</div>;
}
