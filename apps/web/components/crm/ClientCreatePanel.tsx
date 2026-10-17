"use client";
import {useState,useEffect,useRef} from "react";
import {ClientCreateForm} from "./ClientCreateForm";
export function ClientCreatePanel(){
 const panel=useRef<HTMLElement>(null);
 useEffect(()=>{const aside=panel.current?.closest<HTMLElement>('.crm-client-create'),header=document.querySelector<HTMLElement>('.crm-header');if(!aside||!header)return;const measure=()=>aside.style.setProperty('--crm-client-sticky-top',`${header.getBoundingClientRect().height+16}px`);measure();const observer=new ResizeObserver(measure);observer.observe(header);return()=>observer.disconnect();},[]);
 const [expanded,setExpanded]=useState(false);
 return <section ref={panel} className={`crm-client-create-panel${expanded?" is-expanded":""}`}>
  <div className="crm-client-create-toolbar"><button type="button" className="crm-client-create-toggle" aria-expanded={expanded} aria-controls="crm-client-create-fields" onClick={()=>setExpanded(value=>!value)}>Добавить клиента <span aria-hidden="true">{expanded?"−":"+"}</span></button><div id="crm-client-view-mobile"/></div>
  <div id="crm-client-create-fields"><ClientCreateForm /></div>
 </section>;
}
