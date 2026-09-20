"use client";

import { useEffect, useRef, useState } from "react";
import { unseenNewLeads, leadAlertTime, type AlertLead } from "../../lib/crm-alert-state";
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
export function CrmLiveAlerts({userId, floating=false}:{userId:string;floating?:boolean}) {
  const [enabled,setEnabled]=useState(false),[count,setCount]=useState(0),[pending,setPending]=useState<AlertLead[]>([]),[authorized,setAuthorized]=useState(true);
  const [audioBlocked,setAudioBlocked]=useState(false);
  const pendingRef=useRef(pending);pendingRef.current=pending;
  const enabledRef=useRef(enabled);enabledRef.current=enabled;
  const tab=useRef("");
  const notifiedRef=useRef("");
  const ackKey=`avtocena_crm_ack_${userId}`,leaseKey=`avtocena_crm_alert_tab_${userId}`;
  useEffect(()=>{
    tab.current=crypto.randomUUID();
    setEnabled(get(ENABLED_KEY)==="1");
    const sync=(event:StorageEvent)=>{
      if(event.key===ENABLED_KEY)setEnabled(event.newValue==="1");
      if(event.key===ackKey){const ack=Number(event.newValue||0);setPending(rows=>unseenNewLeads(rows,ack));}
    };
    const unlock=()=>{if(enabledRef.current){unlockAudio();setAudioBlocked(false);}};
    window.addEventListener("storage",sync);window.addEventListener("pointerdown",unlock);window.addEventListener("keydown",unlock);
    return ()=>{window.removeEventListener("storage",sync);window.removeEventListener("pointerdown",unlock);window.removeEventListener("keydown",unlock);};
  },[ackKey]);
  useEffect(()=>{
    let active=true,busy=false;
    const poll=async()=>{
      if(busy)return;busy=true;
      try {
        const response=await fetch("/api/crm/inbox",{cache:"no-store"});
        if(response.status===401 || response.status===403){if(active){setAuthorized(false);setPending([]);setCount(0);}return;}
        if(!response.ok)return;
        const data=await response.json();if(!active)return;
        setAuthorized(true);setCount(Number(data.newCount)||0);
        const unseen=unseenNewLeads(Array.isArray(data.leads)?data.leads:[],Number(get(ackKey)||0));
        setPending(unseen);
      }catch{}finally{busy=false;}
    };
    void poll();const timer=setInterval(()=>void poll(),20_000);
    const focus=()=>void poll();window.addEventListener("focus",focus);
    return ()=>{active=false;clearInterval(timer);window.removeEventListener("focus",focus);};
  },[ackKey]);
  useEffect(()=>{
    if(!enabled || !pending.length || !authorized)return;
    const ring=()=>{
      // One sound source across CRM and public tabs; the lease expires if a tab closes.
      let lease:{id?:string;until?:number}={};try{lease=JSON.parse(get(leaseKey)||"{}");}catch{}
      if(lease.id!==tab.current && Number(lease.until)>Date.now())return;
      put(leaseKey,JSON.stringify({id:tab.current,until:Date.now()+1800}));
      beep();setAudioBlocked(!audio || audio.state!=="running");
      const newest=pending[0];
      const eventKey=`${newest.id}:${leadAlertTime(newest)}`;
      if(notifiedRef.current!==eventKey && "Notification" in window && Notification.permission==="granted"){
        notifiedRef.current=eventKey;
        try{const notice=new Notification("Новые заявки · АвтоЦена",{body:`Непросмотренных заявок: ${pending.length}`,tag:`avtocena-${userId}-${eventKey}`,icon:"/logo/avtocena-mark-light.svg",requireInteraction:true});notice.onclick=()=>{window.focus();location.assign("/crm/leads");notice.close();};}catch{}
      }
    };
    ring();const timer=setInterval(ring,1000);
    return ()=>{clearInterval(timer);try{if(JSON.parse(get(leaseKey)||"{}").id===tab.current)put(leaseKey,"{}");}catch{}};
  },[enabled,pending,authorized,leaseKey,userId]);
  function acknowledge(){
    const latest=Math.max(Number(get(ackKey)||0),...pendingRef.current.map(leadAlertTime));
    put(ackKey,String(latest));setPending([]);
  }
  function toggle(){
    const next=!enabled;setEnabled(next);put(ENABLED_KEY,next?"1":"0");
    if(next){unlockAudio();beep();if("Notification" in window && Notification.permission==="default")void Notification.requestPermission().catch(()=>{});}
  }
  if(!authorized)return null;
  return <div className={floating?"fixed right-3 bottom-24 z-[110]":"contents"}>
    <button type="button" onClick={toggle} aria-pressed={enabled} title={enabled?"Отключить звук заявок":"Включить звук заявок"} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-slate-500/30 bg-slate-800 px-3 py-2 text-xs font-bold text-white shadow-lg"><span aria-hidden>{enabled?"🔔":"🔕"}</span>Заявки{Math.max(count,pending.length)>0?<span className="rounded-full bg-red-500 px-2 py-0.5 text-white">{Math.max(count,pending.length)}</span>:null}</button>
    {pending.length>0?<div role="status" className="fixed right-4 top-20 z-[120] w-[min(92vw,370px)] rounded-2xl border border-slate-500 bg-slate-800 p-4 text-white shadow-2xl">
      <p className="font-bold">Новые заявки: {pending.length}</p>
      {enabled && audioBlocked?<button type="button" onClick={()=>{unlockAudio();setAudioBlocked(false);}} className="mt-2 text-xs underline">Нажмите, чтобы разрешить звук</button>:null}
      <div className="mt-3 flex gap-4"><a href="/crm/leads" onClick={acknowledge} className="text-sm font-bold underline">Открыть заявки</a><button type="button" onClick={acknowledge} className="text-sm underline">Прочитано</button></div>
    </div>:null}
  </div>;
}
