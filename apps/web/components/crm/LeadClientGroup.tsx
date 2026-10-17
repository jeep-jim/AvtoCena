'use client';
import {useEffect,useRef,type ReactNode} from 'react';
import {ChevronDown} from 'lucide-react';
export function LeadClientGroup({grouped,heading,children}:{grouped:boolean;heading:ReactNode;children:ReactNode}){
 const ref=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{const group=ref.current,header=document.querySelector<HTMLElement>('.crm-header');if(!group||!header)return;const measure=()=>group.style.setProperty('--crm-group-top',`${header.getBoundingClientRect().height+6}px`);measure();const observer=new ResizeObserver(measure);observer.observe(header);return()=>observer.disconnect();},[grouped]);
 if(!grouped)return <section aria-label="Заявки клиента">{children}</section>;
 return <details ref={ref} className="crm-lead-client-group rounded-2xl border border-[var(--ac-border)] bg-[var(--ac-surface-2)]"><summary className="crm-lead-group-heading"><div className="crm-lead-group-content">{heading}</div><ChevronDown size={18} className="crm-group-chevron"/></summary>{children}</details>;
}
