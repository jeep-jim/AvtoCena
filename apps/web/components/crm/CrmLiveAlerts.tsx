"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, UserRound, Volume2, VolumeX, Settings, ClipboardList } from "lucide-react";
import { type AlertLead } from "../../lib/crm-alert-state";
const ENABLED_KEY="avtocena_crm_notifications_enabled";
const get=(key:string)=>{try{return localStorage.getItem(key);}catch{return null;}};
const put=(key:string,value:string)=>{try{localStorage.setItem(key,value);}catch{}};
let audio:AudioContext|null=null;
function unlockAudio(){
  try { const AudioCtor=window.AudioContext || (window as any).webkitAudioContext;
    if(!AudioCtor)return;
    if(!audio || audio.state==="closed")audio=new AudioCtor();
    void audio!.resume().catch(()=>{});
  }catch{}
}
function beep(){
  try {
    if(!audio || audio.state!=="running")return;
    const oscillator=audio.createOscillator(),gain=audio.createGain(),now=audio.currentTime;
    oscillator.type="sine";oscillator.frequency.setValueAtTime(880,now);
    gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.12,now+.02);gain.gain.exponentialRampToValueAtTime(.0001,now+.3);
    oscillator.connect(gain);gain.connect(audio.destination);oscillator.start();oscillator.stop(now+.32);
    oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
  }catch{}
}
type InboxLead = AlertLead & {unread:boolean;assignmentUnread?:boolean;eventKey:string};
export function CrmLiveAlerts({userId, role="manager", displayName="Кабинет", header=false}:{userId:string;role?:string;displayName?:string;header?:boolean}) {
  const [enabled,setEnabled]=useState(false),[pending,setPending]=useState<InboxLead[]>([]),[authorized,setAuthorized]=useState(true);
  const [audioBlocked,setAudioBlocked]=useState(false);
  const [menuOpen,setMenuOpen]=useState(false),[ackError,setAckError]=useState(""),[acknowledging,setAcknowledging]=useState(false);
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!menuOpen)return;const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setMenuOpen(false);};const escape=(event:KeyboardEvent)=>{if(event.key==="Escape")setMenuOpen(false);};document.addEventListener("pointerdown",close);document.addEventListener("keydown",escape);return()=>{document.removeEventListener("pointerdown",close);document.removeEventListener("keydown",escape);};},[menuOpen]);
  const pendingRef=useRef(pending);pendingRef.current=pending;
  const enabledRef=useRef(enabled);enabledRef.current=enabled;
  const tab=useRef("");
  const notifiedRef=useRef("");
  const leaseKey=`avtocena_crm_alert_tab_${userId}`;
  useEffect(()=>{
    tab.current=crypto.randomUUID();
    setEnabled(get(ENABLED_KEY)==="1");
    const sync=(event:StorageEvent)=>{
      if(event.key===ENABLED_KEY)setEnabled(event.newValue==="1");
    };
    const unlock=()=>{if(enabledRef.current){unlockAudio();setAudioBlocked(false);}};
    window.addEventListener("storage",sync);window.addEventListener("pointerdown",unlock);window.addEventListener("keydown",unlock);
    return ()=>{window.removeEventListener("storage",sync);window.removeEventListener("pointerdown",unlock);window.removeEventListener("keydown",unlock);};
  },[userId]);
  useEffect(()=>{
    let active=true,busy=false;
    const poll=async()=>{
      if(busy)return;busy=true;
      try {
        const response=await fetch("/api/crm/inbox",{cache:"no-store"});
        if(response.status===401 || response.status===403){if(active){setAuthorized(false);setPending([]);}return;}
        if(!response.ok)return;
        const data=await response.json();if(!active)return;
        setAuthorized(true);
        const unseen=(Array.isArray(data.leads)?data.leads:[]).filter((lead:InboxLead)=>lead.unread);
        setPending(unseen);
      }catch{}finally{busy=false;}
    };
    void poll();const timer=setInterval(()=>void poll(),20_000);
    const focus=()=>void poll();window.addEventListener("focus",focus);window.addEventListener("avtocena:lead-read",focus);
    const sync=(event:StorageEvent)=>{if(event.key===`avtocena_crm_read_changed_${userId}`)void poll();};window.addEventListener("storage",sync);
    return ()=>{active=false;clearInterval(timer);window.removeEventListener("focus",focus);window.removeEventListener("avtocena:lead-read",focus);window.removeEventListener("storage",sync);};
  },[userId]);
  useEffect(()=>{
    if(!enabled || !pending.length || !authorized)return;
    const ring=()=>{
      // One sound source across CRM and public tabs; the lease expires if a tab closes.
      let lease:{id?:string;until?:number}={};try{lease=JSON.parse(get(leaseKey)||"{}");}catch{}
      if(lease.id!==tab.current && Number(lease.until)>Date.now())return;
      put(leaseKey,JSON.stringify({id:tab.current,until:Date.now()+1800}));
      beep();setAudioBlocked(!audio || audio.state!=="running");
      const newest=pending[0];
      const eventKey=`${newest.id}:${newest.eventKey}`;
      if(notifiedRef.current!==eventKey && "Notification" in window && Notification.permission==="granted"){
        notifiedRef.current=eventKey;
        try{const notice=new Notification("Новые заявки · АвтоЦена",{body:newest.assignmentUnread?"Вам назначена заявка":"Непросмотренных заявок: "+pending.length,tag:`avtocena-${userId}-${eventKey}`,icon:"/logo/avtocena-mark-light.svg",requireInteraction:true});notice.onclick=()=>{window.focus();location.assign(`/crm/leads?id=${encodeURIComponent(newest.id)}`);notice.close();};}catch{}
      }
    };
    ring();const timer=setInterval(ring,1000);
    return ()=>{clearInterval(timer);try{if(JSON.parse(get(leaseKey)||"{}").id===tab.current)put(leaseKey,"{}");}catch{}};
  },[enabled,pending,authorized,leaseKey,userId]);
  async function acknowledge(){
    setAckError("");setAcknowledging(true);
    const rows=[...pendingRef.current];
    const results:PromiseSettledResult<InboxLead>[]=[];
    for(let i=0;i<rows.length;i+=4)results.push(...await Promise.allSettled(rows.slice(i,i+4).map(async lead=>{
      const response=await fetch(`/api/crm/leads/${encodeURIComponent(lead.id)}/seen`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({eventKey:lead.eventKey})});
      if(!response.ok)throw new Error();return lead;
    })));
    setAcknowledging(false);
    const confirmed=results.flatMap(result=>result.status==="fulfilled"?[result.value]:[]);
    setPending(current=>current.filter(row=>!confirmed.some(done=>done.id===row.id&&done.eventKey===row.eventKey)));
    if(confirmed.length!==rows.length)setAckError("Не все отметки сохранены. Обновите заявки и повторите.");
    put(`avtocena_crm_read_changed_${userId}`,String(Date.now()));window.dispatchEvent(new Event("avtocena:lead-read"));
  }
  function toggle(){
    const next=!enabled;setEnabled(next);put(ENABLED_KEY,next?"1":"0");
    if(next){unlockAudio();beep();if("Notification" in window && Notification.permission==="default")void Notification.requestPermission().catch(()=>{});}
  }
  if(!authorized)return null;
  const badge=pending.length>0?<span className="ac-staff-badge">{pending.length}</span>:null;
  const assigned=pending.some(lead=>lead.assignmentUnread);
  return <div ref={root} className={`ac-staff-tools ${header?"ac-staff-tools--header":""}`}>
    <a href="/crm/leads" className="ac-staff-leads" aria-label={`Заявки${pending.length?`: непросмотренных ${pending.length}`:""}`}><Bell size={17}/><span>Заявки</span>{badge}</a>
    <button type="button" className="ac-staff-account" aria-label="Кабинет сотрудника" aria-expanded={menuOpen} aria-controls={`staff-menu-${userId}`} onClick={()=>setMenuOpen(!menuOpen)}><UserRound size={21}/><span className="ac-staff-mobile-badge">{badge}</span></button>
    {menuOpen?<div id={`staff-menu-${userId}`} className="ac-staff-menu">
      <p className="ac-staff-name">{displayName}</p>
      <a href="/crm/leads"><ClipboardList size={18}/>Заявки{badge}</a>
      <a href="/crm"><UserRound size={18}/>Рабочий кабинет</a>
      {["owner","admin"].includes(role)?<a href="/crm/settings"><Settings size={18}/>Настройки</a>:null}
      <button type="button" onClick={toggle} aria-pressed={enabled}>{enabled?<Volume2 size={18}/>:<VolumeX size={18}/>}Звук заявок: {enabled?"включён":"выключен"}</button>
      {enabled&&audioBlocked?<button type="button" onClick={()=>{unlockAudio();setAudioBlocked(false);}}>Разрешить воспроизведение звука</button>:null}
    </div>:null}
    {pending.length>0?<div role="status" className="ac-staff-notice">
      <p className="font-bold">{assigned?"Вам назначена заявка":"Новые заявки"}: {pending.length}</p>
      {enabled && audioBlocked?<button type="button" onClick={()=>{unlockAudio();setAudioBlocked(false);}} className="mt-2 text-xs underline">Нажмите, чтобы разрешить звук</button>:null}
      <div className="mt-3 flex gap-4"><a href={pending.length===1?`/crm/leads?id=${encodeURIComponent(pending[0].id)}`:"/crm/leads"} className="text-sm font-bold underline">Открыть заявки</a><button type="button" disabled={acknowledging} onClick={()=>void acknowledge()} className="text-sm underline">{acknowledging?"Сохраняем…":"Прочитано мной"}</button></div>
      {ackError?<p className="mt-2 text-xs">{ackError}</p>:null}
    </div>:null}
    <style dangerouslySetInnerHTML={{__html:`
      .ac-staff-tools{position:relative;display:flex;align-items:center;gap:6px;color:var(--ac-text,#fff)}
      .ac-staff-leads,.ac-staff-account{display:flex;align-items:center;justify-content:center;gap:7px;height:44px;border-radius:12px;background:var(--ac-surface-2,#273343);color:inherit;font-size:12px;font-weight:700}
      .ac-staff-leads{padding:0 12px}.ac-staff-account{width:40px;position:relative}.ac-staff-mobile-badge{display:none}
      .ac-staff-badge{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 5px;border-radius:20px;background:#ff353d!important;color:#fff!important;-webkit-text-fill-color:#fff!important;font-size:11px}
      .ac-staff-menu,.ac-staff-notice{position:absolute;right:0;top:calc(100% + 12px);width:290px;max-width:calc(100vw - 24px);border:1px solid var(--ac-border,#526074);border-radius:16px;background:var(--ac-surface-2,#273343);color:var(--ac-text,#fff);padding:12px;z-index:130}
      .ac-staff-menu{z-index:140}.ac-staff-menu a,.ac-staff-menu>button{display:flex;align-items:center;gap:10px;min-height:44px;width:100%;padding:8px;border-radius:8px;font-size:13px;text-align:left}.ac-staff-menu a:hover,.ac-staff-menu>button:hover{background:var(--ac-surface-3,#344156)}.ac-staff-name{font-size:13px;font-weight:700;padding:6px 8px;border-bottom:1px solid var(--ac-border,#526074)}
      html[data-theme="light"] .ac-staff-menu,html[data-theme="light"] .ac-staff-notice{background:#fff!important;color:#172130!important;border-color:#ccd3de}
      @media(max-width:767px){.ac-staff-tools--header .ac-staff-leads{display:none}.ac-staff-tools--header .ac-staff-mobile-badge{display:block;position:absolute;right:-5px;top:-5px}.ac-staff-tools--header .ac-staff-menu,.ac-staff-tools--header .ac-staff-notice{position:fixed;top:70px;right:12px}.ac-staff-tools--header .ac-staff-account{width:36px}.ac-public-header .ac-icon-button,.ac-public-header .ac-favorite-nav{width:36px!important;min-width:36px!important}.ac-public-header>div{gap:6px!important;padding-left:10px!important;padding-right:10px!important}}
    `}}/>
  </div>;
}
