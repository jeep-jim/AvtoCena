"use client";
import {useEffect,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import type {LeadReadReceipt} from "../../lib/crm-read-state";
export function LeadReadStatus({leadId,userId,eventKey,initialReceipts}:{leadId:string;userId:string;eventKey:string;initialReceipts:LeadReadReceipt[]}) {
 const root=useRef<HTMLDivElement>(null),router=useRouter();
 const [receipts,setReceipts]=useState(initialReceipts),[error,setError]=useState("");
 const [changed,setChanged]=useState(false);
 useEffect(()=>{setReceipts(initialReceipts);},[initialReceipts]);
 useEffect(()=>{
  const details=root.current?.closest("details");if(!details)return;
  let active=true,busy=false,marked=false;
  const mark=async()=>{
   if(!details.open||busy||marked)return;busy=true;
   try{const response=await fetch(`/api/crm/leads/${encodeURIComponent(leadId)}/seen`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({eventKey})});
    if(!active)return;
    if(response.status===409){setChanged(true);return;}
    if(!response.ok)throw new Error();const data=await response.json();if(!active)return;
    marked=true;setReceipts(data.readReceipts);setError("");setChanged(false);
    try{localStorage.setItem(`avtocena_crm_read_changed_${userId}`,String(Date.now()));}catch{}
    window.dispatchEvent(new Event("avtocena:lead-read"));
   }catch{if(active)setError("Не удалось сохранить просмотр. Повторите открытие заявки.");}finally{busy=false;}
  };
  const refresh=async()=>{
   if(!details.open)return;
   try{const response=await fetch(`/api/crm/leads/${encodeURIComponent(leadId)}/seen`,{cache:"no-store"});if(!response.ok)return;const data=await response.json();if(active){setReceipts(data.readReceipts);setChanged(data.state.eventKey!==eventKey);}}catch{}
  };
  const toggle=()=>{void mark();};details.addEventListener("toggle",toggle);void mark();const timer=setInterval(()=>void refresh(),20_000);
  return()=>{active=false;clearInterval(timer);details.removeEventListener("toggle",toggle);};
 },[leadId,userId,eventKey]);
 return <div ref={root} className="mb-4 rounded-xl border border-[var(--ac-border)] p-3 text-xs">
  <p className="font-bold">Просмотры команды</p>
  {receipts.length?<ul className="mt-2 space-y-1">{receipts.map(row=><li key={row.userId}>{row.displayName}{row.userId===userId?" (вы)":""} · {new Date(row.seenAt).toLocaleString("ru-RU",{timeZone:"Europe/Moscow"})} МСК{Date.parse(row.incomingAt)<Date.parse(JSON.parse(eventKey)[0])?" · до последнего сообщения":""}</li>)}</ul>:<p className="mt-1 text-[var(--ac-muted)]">Пока нет подтверждённых просмотров.</p>}
  <p className="mt-2 text-[var(--ac-muted)]">Просмотр не меняет статус заявки и не снимает уведомление у других сотрудников.</p>
  {changed?<button type="button" onClick={()=>router.refresh()} className="mt-2 font-bold underline">Есть новые данные — обновить заявку</button>:null}
  {error?<p role="alert" className="mt-2">{error}</p>:null}
 </div>;
}
