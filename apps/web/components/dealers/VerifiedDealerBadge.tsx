"use client";
import {useRef,useState} from 'react';
import {BadgeCheck} from 'lucide-react';
export function VerifiedDealerBadge(){
 const ref=useRef<HTMLDetailsElement>(null);
 const [left,setLeft]=useState(0);
 const place=()=>{const x=ref.current?.getBoundingClientRect().left;if(x!==undefined)setLeft(Math.max(12,Math.min(x,window.innerWidth-236))-x);};
 return <details ref={ref} onMouseEnter={place} onFocus={place} onToggle={place} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))event.currentTarget.open=false;}} className="dealer-verification relative inline-flex shrink-0 text-emerald-500"><summary className="cursor-pointer list-none rounded-full [&::-webkit-details-marker]:hidden" aria-label="Проверенный дилер" title="Проверенный дилер"><BadgeCheck size={22}/></summary><span style={{left}} className="absolute top-8 z-50 w-56 rounded-xl bg-[var(--ac-surface)] p-3 text-xs font-medium text-[var(--ac-text)] shadow-xl">Проверенный дилер — компания прошла проверку АвтоЦены.</span></details>;
}
