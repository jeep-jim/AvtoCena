"use client";
import {StaffToolsStyles} from './StaffToolsStyles';
import Link from 'next/link';
import {OPEN_SELECTION_PANEL} from '@/lib/dealers/selection-share';
import {NotificationReply} from './NotificationReply';
import {BirthdayCelebration} from './BirthdayCelebration';
import type {BirthdayCelebration as Birthday} from '../../lib/crm-birthday-celebrations';
import {ReminderRows} from "./Reminders";
import type {CrmReminder} from "../../lib/crm-reminders";
import type {CrmNotice} from "../../lib/crm-unified-notifications";

import { StaffHeartbeat } from "./StaffPresence";
import { CrmPushControl, unsubscribeStaffPush } from "./CrmPushControl";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Share2, Bell, UserRound, Volume2, VolumeX, Settings, ClipboardList, ChevronDown, AlarmClock, X } from "lucide-react";
import { canMigrateLegacyAcknowledgement, type AlertLead } from "../../lib/crm-alert-state";
const ENABLED_KEY="avtocena_crm_notifications_enabled";
const get=(key:string)=>{try{return localStorage.getItem(key);}catch{return null;}};
const put=(key:string,value:string)=>{try{localStorage.setItem(key,value);}catch{}};
let audio:AudioContext|null=null;
const playing=new Set<OscillatorNode>();
function stopBeep(){for(const oscillator of playing){try{oscillator.stop();}catch{}}playing.clear();}
function dismissedEvents(key:string):Set<string>{try{const rows=JSON.parse(get(key)||"[]");return new Set(Array.isArray(rows)?rows.filter(v=>typeof v==="string"):[]);}catch{return new Set();}}

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
    oscillator.connect(gain);gain.connect(audio.destination);playing.add(oscillator);oscillator.start();oscillator.stop(now+.32);
    oscillator.onended=()=>{playing.delete(oscillator);oscillator.disconnect();gain.disconnect();};
  }catch{}
}
type InboxLead = AlertLead & {unread:boolean;assignmentUnread?:boolean;hasReadReceipt?:boolean;assignmentAt?:string;eventKey:string;name?:string;phone?:string;telegram?:string;car?:string;offerTitle?:string;selectedOffers?:{title:string}[]};
export function CrmLiveAlerts({userId, role="manager", displayName="Кабинет", header=false,crm=false,avatar,canCreateSelection=false}:{userId:string;role?:string;displayName?:string;header?:boolean;crm?:boolean;avatar?:string;canCreateSelection?:boolean}) {
  const [enabled,setEnabled]=useState(false),[pending,setPending]=useState<InboxLead[]>([]),[authorized,setAuthorized]=useState(true);
  const [recent,setRecent]=useState<InboxLead[]>([]),[leadsOpen,setLeadsOpen]=useState(false);
  const [notifications,setNotifications]=useState<CrmNotice[]>([]),[reminders,setReminders]=useState<CrmReminder[]>([]),[notificationsOpen,setNotificationsOpen]=useState(false);
  const unreadNotices=notifications.filter(n=>n.unread);
  const [birthdays,setBirthdays]=useState<Birthday[]>([]);
  async function refreshNotices(){try{const r=await fetch('/api/crm/notifications',{cache:'no-store'});if(r.ok){const d=await r.json();setNotifications(d.notifications||[]);setReminders(d.reminders||[]);if(crm)setBirthdays(d.birthdayCelebrations||[]);}}catch{}}
  useEffect(()=>{let busy=false;const poll=async()=>{if(busy||document.visibilityState!=='visible')return;busy=true;try{await refreshNotices();}finally{busy=false;}};void poll();const timer=setInterval(poll,20000);window.addEventListener('avtocena:reminders',poll);window.addEventListener('avtocena:crm-change',poll);document.addEventListener('visibilitychange',poll);return()=>{clearInterval(timer);window.removeEventListener('avtocena:reminders',poll);window.removeEventListener('avtocena:crm-change',poll);document.removeEventListener('visibilitychange',poll);};},[userId]);
  async function readNotices(ids:string[]){if(!ids.length)return;try{const r=await fetch('/api/crm/notifications',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ids})});if(!r.ok)throw Error();setNotifications(rows=>rows.map(n=>ids.includes(n.id)?{...n,unread:false}:n));}catch{setAckError('Не удалось отметить уведомления прочитанными.');}}
  const dismissKey=`avtocena_crm_dismissed_${userId}`;
  const [dismissed,setDismissed]=useState<Set<string>>(new Set());
  const leadKey=(lead:InboxLead)=>`lead:${lead.id}:${lead.eventKey}`;
  const noticeKey=(notice:CrmNotice)=>`notice:${notice.id}:${notice.createdAt}`;
  const alertKeys=[...pending.map(leadKey),...unreadNotices.map(noticeKey)];
  const alertKeysRef=useRef(alertKeys);alertKeysRef.current=alertKeys;
  const hasAlert=alertKeys.some(key=>!dismissed.has(key));
  useEffect(()=>{
    const sync=()=>{const next=dismissedEvents(dismissKey);setDismissed(next);if(!alertKeysRef.current.some(key=>!next.has(key)))stopBeep();};
    const storage=(event:StorageEvent)=>{if(event.key===dismissKey)sync();};
    sync();window.addEventListener('storage',storage);window.addEventListener('avtocena:alert-dismissed',sync);
    return()=>{window.removeEventListener('storage',storage);window.removeEventListener('avtocena:alert-dismissed',sync);};
  },[dismissKey]);
  function dismissAlert(){
    const next=dismissedEvents(dismissKey);for(const key of alertKeys)next.add(key);
    put(dismissKey,JSON.stringify([...next].slice(-2000)));setDismissed(next);stopBeep();
    window.dispatchEvent(new Event('avtocena:alert-dismissed'));
  }
  const soundKey=`${ENABLED_KEY}_${userId}`;
  const [audioBlocked,setAudioBlocked]=useState(false);
  const [menuOpen,setMenuOpen]=useState(false),[ackError,setAckError]=useState(""),[acknowledging,setAcknowledging]=useState(false);
  const [menuBox,setMenuBox]=useState<{left:number;top:number;width:number}|null>(null);
  useLayoutEffect(()=>{
    if(!menuOpen)return;
    const header=root.current?.closest('header');if(!header)return;
    const column=document.querySelector<HTMLElement>('.ac-offer-detail-stack');
    const anchor=column||root.current?.parentElement;
    const align=()=>{
      const rect=anchor?.getBoundingClientRect(),head=header.getBoundingClientRect();
      const width=innerWidth<768?innerWidth-24:Math.min(innerWidth-24,Math.max(290,rect?.width||290));
      const left=innerWidth<768?12:Math.max(12,Math.min(innerWidth-width-12,column&&rect?rect.left:(rect?.right||innerWidth-12)-width));
      setMenuBox({left,top:head.bottom+4,width});
    };
    align();const observer=new ResizeObserver(align);if(anchor)observer.observe(anchor);observer.observe(header);
    window.addEventListener('resize',align);return()=>{observer.disconnect();window.removeEventListener('resize',align);};
  },[menuOpen]);
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!menuOpen&&!notificationsOpen)return;const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node)){setMenuOpen(false);setNotificationsOpen(false);}};const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"){setMenuOpen(false);setNotificationsOpen(false);}};document.addEventListener("pointerdown",close);document.addEventListener("keydown",escape);return()=>{document.removeEventListener("pointerdown",close);document.removeEventListener("keydown",escape);};},[menuOpen,notificationsOpen]);
  const pendingRef=useRef(pending);pendingRef.current=pending;
  const enabledRef=useRef(enabled);enabledRef.current=enabled;
  const tab=useRef("");
  const notifiedRef=useRef("");
  const leaseKey=`avtocena_crm_alert_tab_${userId}`;
  useEffect(()=>{
    tab.current=crypto.randomUUID();
    if(get(soundKey)===null && get(ENABLED_KEY)!==null)put(soundKey,get(ENABLED_KEY)!);
    setEnabled(get(soundKey)==="1");
    const sync=(event:StorageEvent)=>{
      if(event.key===soundKey)setEnabled(event.newValue==="1");
    };
    const localSync=()=>setEnabled(get(soundKey)==="1");
    window.addEventListener("avtocena:sound-preference",localSync);
    const unlock=()=>{if(enabledRef.current){unlockAudio();setAudioBlocked(false);}};
    window.addEventListener("storage",sync);window.addEventListener("pointerdown",unlock);window.addEventListener("keydown",unlock);
    return ()=>{window.removeEventListener("avtocena:sound-preference",localSync);window.removeEventListener("storage",sync);window.removeEventListener("pointerdown",unlock);window.removeEventListener("keydown",unlock);};
  },[userId]);
  useEffect(()=>{
    let active=true,busy=false;
    const poll=async()=>{
      if(busy||document.visibilityState!=="visible")return;busy=true;
      try {
        const response=await fetch("/api/crm/inbox",{cache:"no-store"});
        if(response.status===401 || response.status===403){if(active){setAuthorized(false);setPending([]);}return;}
        if(!response.ok)return;
        const data=await response.json();if(!active)return;
        setAuthorized(true);
        setRecent((Array.isArray(data.leads)?data.leads:[]).slice(0,8));
        const unseen:InboxLead[]=(Array.isArray(data.leads)?data.leads:[]).filter((lead:InboxLead)=>lead.unread);
        const legacyAck=Number(get(`avtocena_crm_ack_${userId}`)||0);
        const migrated=new Set<string>();
        const legacy=unseen.filter(lead=>canMigrateLegacyAcknowledgement(lead,legacyAck));
        for(let i=0;i<legacy.length;i+=4)await Promise.all(legacy.slice(i,i+4).map(async lead=>{
          try {const saved=await fetch(`/api/crm/leads/${encodeURIComponent(lead.id)}/seen`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({eventKey:lead.eventKey})});if(saved.ok)migrated.add(lead.id);}catch{}
        }));
        if(!active)return;
        const next=unseen.filter(lead=>!migrated.has(lead.id));
        setPending(next);

      }catch{}finally{busy=false;}
    };
    void poll();const timer=setInterval(()=>void poll(),20_000);
    const focus=()=>void poll();window.addEventListener("focus",focus);document.addEventListener("visibilitychange",focus);window.addEventListener("avtocena:lead-read",focus);
    const sync=(event:StorageEvent)=>{if(event.key===`avtocena_crm_read_changed_${userId}`)void poll();};window.addEventListener("storage",sync);
    return ()=>{active=false;clearInterval(timer);window.removeEventListener("focus",focus);document.removeEventListener("visibilitychange",focus);window.removeEventListener("avtocena:lead-read",focus);window.removeEventListener("storage",sync);};
  },[userId]);
  useEffect(()=>{
    if(!enabled || !hasAlert || !authorized)return;
    const ring=()=>{
      const dismissedNow=dismissedEvents(dismissKey);
      if(!alertKeysRef.current.some(key=>!dismissedNow.has(key)))return;
      // One sound source across CRM and public tabs; the lease expires if a tab closes.
      let lease:{id?:string;until?:number}={};try{lease=JSON.parse(get(leaseKey)||"{}");}catch{}
      if(lease.id!==tab.current && Number(lease.until)>Date.now())return;
      put(leaseKey,JSON.stringify({id:tab.current,until:Date.now()+1800}));
      beep();setAudioBlocked(!audio || audio.state!=="running");
      const newest=pending.find(lead=>!dismissedNow.has(leadKey(lead)));
      if(!newest)return;
      const eventKey=`${newest.id}:${newest.eventKey}`;
      if(document.visibilityState!=="visible" && notifiedRef.current!==eventKey && "Notification" in window && Notification.permission==="granted"){
        notifiedRef.current=eventKey;
        try{const notice=new Notification("Новые заявки · АвтоЦена",{body:newest.assignmentUnread?"Вам назначена заявка":"Непросмотренных заявок: "+pending.length,tag:`avtocena-${userId}-${eventKey}`,icon:"/logo/avtocena-mark-light.svg",requireInteraction:true});notice.onclick=()=>{window.focus();location.assign(`/crm/leads?id=${encodeURIComponent(newest.id)}`);notice.close();};}catch{}
      }
    };
    ring();const timer=setInterval(ring,1000);
    return ()=>{clearInterval(timer);try{if(JSON.parse(get(leaseKey)||"{}").id===tab.current)put(leaseKey,"{}");}catch{}};
  },[enabled,pending,notifications,authorized,leaseKey,userId,hasAlert,dismissKey]);
  useEffect(()=>{const badges=navigator as any,count=pending.length+unreadNotices.length;if(count&&badges.setAppBadge)void badges.setAppBadge(count).catch(()=>{});else if(!count&&badges.clearAppBadge)void badges.clearAppBadge().catch(()=>{});},[pending.length,unreadNotices.length]);
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
  async function readRecent(lead:InboxLead){
    if(!lead.unread)return;
    try{const r=await fetch(`/api/crm/leads/${encodeURIComponent(lead.id)}/seen`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({eventKey:lead.eventKey})});
      if(!r.ok)return;
      setRecent(rows=>rows.map(row=>row.id===lead.id&&row.eventKey===lead.eventKey?{...row,unread:false}:row));
      setPending(rows=>rows.filter(row=>row.id!==lead.id||row.eventKey!==lead.eventKey));
      put(`avtocena_crm_read_changed_${userId}`,String(Date.now()));window.dispatchEvent(new Event('avtocena:lead-read'));
    }catch{}
  }
  function toggle(){
    const next=!enabled;setEnabled(next);put(soundKey,next?"1":"0");window.dispatchEvent(new Event("avtocena:sound-preference"));
    if(next){unlockAudio();beep();if("Notification" in window && Notification.permission==="default")void Notification.requestPermission().catch(()=>{});}
  }
  if(!authorized)return null;
  const badge=pending.length>0?<span className="ac-staff-badge">{pending.length}</span>:null;
  const assignedCount=pending.filter(lead=>lead.assignmentUnread).length;
  return <div ref={root} className={`ac-staff-tools ${header?"ac-staff-tools--header":""} ${crm?"ac-staff-tools--crm":""}`}>
    {crm?<BirthdayCelebration key={userId} birthdays={birthdays}/>:null}
    <StaffHeartbeat/>
    <button type="button" className="ac-staff-account" aria-label={`Уведомления: ${pending.length+unreadNotices.length}`} aria-expanded={notificationsOpen} onClick={()=>{setNotificationsOpen(!notificationsOpen);setMenuOpen(false);}}><Bell size={19}/>{pending.length+unreadNotices.length>0?<span className="ac-unified-badge ac-staff-badge">{pending.length+unreadNotices.length}</span>:null}</button>
    {notificationsOpen?<section className="ac-unified-notifications" aria-label="Все уведомления"><div className="ac-notifications-heading"><strong>Уведомления</strong><button type="button" aria-label="Закрыть уведомления" onClick={()=>setNotificationsOpen(false)}><X size={20}/></button></div>
    {pending.length+unreadNotices.length>0?<button type="button" className="ac-notifications-read" onClick={()=>{void acknowledge();void readNotices(unreadNotices.map(n=>n.id));}}>Отметить прочитанными</button>:<p className="ac-notifications-empty">Новых уведомлений нет</p>}
    {pending.map(lead=><a className="ac-notification is-unread" key={lead.id} href={`/crm/leads?id=${encodeURIComponent(lead.id)}`} onClick={()=>void readRecent(lead)}><strong>{lead.assignmentUnread?'Вам назначена заявка':'Новая заявка'} · {lead.name||'Клиент'}</strong><span>{lead.offerTitle||lead.car||lead.selectedOffers?.map(o=>o.title).join(', ')||'Подбор автомобиля'}</span></a>)}
    {unreadNotices.map(n=><div key={n.id} className={`ac-notification ${n.unread?'is-unread':''}`}>{n.href?<a href={n.href} onClick={()=>void readNotices([n.id])}><strong>{n.title}</strong><span>{n.text}</span>{n.kind==='comment'?<small className="mt-2 block font-bold">Открыть обсуждение и ответить →</small>:null}</a>:<><strong>{n.title}</strong><span>{n.text}</span></>}<NotificationReply target={n.replyTarget} title={n.title} text={n.text}/>{n.unread?<button type="button" onClick={()=>void readNotices([n.id])}>Прочитано</button>:null}</div>)}
    <h3 className="ac-notifications-subtitle"><AlarmClock size={17}/>Напоминания команды</h3>
    {!reminders.some(r=>Date.parse(r.dueAt)<=Date.now())?<p className="ac-notifications-empty">На сейчас напоминаний нет</p>:null}
    <ReminderRows rows={reminders.filter(r=>Date.parse(r.dueAt)<=Date.now())} onChange={()=>void refreshNotices()}/>
    {reminders.some(r=>Date.parse(r.dueAt)>Date.now())?<><h4 className="ac-notifications-subtitle">Предстоящие</h4><ReminderRows rows={reminders.filter(r=>Date.parse(r.dueAt)>Date.now())} onChange={()=>void refreshNotices()}/></>:null}
    {ackError?<p role="alert">{ackError}</p>:null}</section>:null}
    <button type="button" className="ac-staff-account" aria-label="Кабинет сотрудника" aria-expanded={menuOpen} aria-controls={`staff-menu-${userId}`} onClick={()=>{setMenuOpen(!menuOpen);setNotificationsOpen(false);}}>{avatar ? <img src={avatar} alt="" width={40} height={44} className="h-full w-full rounded-xl object-cover" referrerPolicy="no-referrer"/> : <UserRound size={21}/>}</button>
    <div hidden={!menuOpen} id={`staff-menu-${userId}`} className="ac-staff-menu" style={menuBox?{position:'fixed',left:menuBox.left,right:'auto',top:menuBox.top,width:menuBox.width}:undefined}>
      <p className="ac-staff-name">{displayName}{crm?<small className="block text-xs font-normal">{({owner:"Владелец",admin:"Администратор",manager:"Менеджер"} as Record<string,string>)[role]||role}</small>:null}</p>
      <button type="button" onClick={()=>setLeadsOpen(!leadsOpen)} aria-expanded={leadsOpen}><ClipboardList size={18}/>Заявки{badge}<ChevronDown size={18} style={{marginLeft:'auto',transform:leadsOpen?'rotate(180deg)':undefined}}/></button>
      <button type="button" onClick={()=>{setMenuOpen(false);setNotificationsOpen(true);}}><AlarmClock size={18}/>Напоминания и уведомления{unreadNotices.length?<span className="ac-staff-badge">{unreadNotices.length}</span>:null}</button>
      {leadsOpen?<div className="ac-staff-recent">{recent.length?recent.map(lead=><details key={lead.id} onToggle={event=>{if(event.currentTarget.open)void readRecent(lead);}}><summary>{lead.unread?<i aria-label="Не просмотрена"/>:null}<span>{lead.name||'Новая заявка'}<small>{lead.offerTitle||lead.car||lead.selectedOffers?.map(o=>o.title).join(', ')||'Подбор автомобиля'}</small></span><ChevronDown size={15}/></summary><div>{lead.phone?<a href={`tel:${lead.phone.replace(/[^+0-9]/g,'')}`}>{lead.phone}</a>:null}{lead.telegram?<p>{lead.telegram}</p>:null}<a href={`/crm/leads?id=${encodeURIComponent(lead.id)}`}>Открыть заявку →</a></div></details>):<p>Заявок пока нет</p>}<a href="/crm/leads">Все заявки →</a></div>:null}
      <div className="ac-staff-menu-settings">
      <a href={`/crm/managers/${encodeURIComponent(userId)}`}><UserRound size={18}/>Мой профиль</a>{!crm&&<a href="/crm"><ClipboardList size={18}/>Рабочий кабинет</a>}

      <button type="button" onClick={toggle} aria-pressed={enabled}>{enabled?<Volume2 size={18}/>:<VolumeX size={18}/>}Звук уведомлений: {enabled?"включён":"выключен"}</button>
      {enabled&&audioBlocked?<button type="button" onClick={()=>{unlockAudio();setAudioBlocked(false);}}>Разрешить воспроизведение звука</button>:null}

      {crm?<form onSubmit={event=>{event.preventDefault();const form=event.currentTarget;put(soundKey,"0");void unsubscribeStaffPush(userId).finally(()=>form.submit());}} action="/api/auth/logout?redirect=/login" method="post"><button type="submit" className="w-full min-h-11 px-2 text-left text-sm">Выйти</button></form>:null}
      <CrmPushControl userId={userId}/>
      </div>
      {canCreateSelection&&<Link className="ac-staff-selection" href="/dealers/dealer_topavto?selection=1&filters=1#catalog" onClick={event=>{if(document.querySelector('[data-dealer-context="dealer_topavto"] .dealer-profile')){event.preventDefault();window.dispatchEvent(new CustomEvent(OPEN_SELECTION_PANEL,{detail:{dealerId:'dealer_topavto'}}));}setMenuOpen(false);}}><Share2 size={18}/>Подборка для клиента</Link>}
    </div>
    {!notificationsOpen&&hasAlert?<div role="status" className="ac-staff-notice">
      <button type="button" className="ac-staff-notice-close" aria-label="Закрыть и остановить звук" onClick={dismissAlert}><X size={20}/></button>
      <p className="font-bold">{pending.length?`Новые заявки: ${pending.length}`:unreadNotices[0]?.title}</p>{unreadNotices.length>0?<button className="ac-staff-notice-action" type="button" onClick={()=>{setNotificationsOpen(true);setMenuOpen(false);}}>Открыть уведомления ({unreadNotices.length})</button>:null}
      {assignedCount>0?<p className="mt-1 text-sm">Назначено вам: {assignedCount}</p>:null}
      {enabled && audioBlocked?<button type="button" onClick={()=>{unlockAudio();setAudioBlocked(false);}} className="mt-2 text-xs underline">Нажмите, чтобы разрешить звук</button>:null}
      {pending.length>0?<div className="ac-staff-notice-actions"><a href={pending.length===1?`/crm/leads?id=${encodeURIComponent(pending[0].id)}`:"/crm/leads"} className="ac-staff-notice-action">Открыть заявки</a><button type="button" disabled={acknowledging} onClick={()=>void acknowledge()} className="ac-staff-notice-action">{acknowledging?"Сохраняем…":"Прочитано мной"}</button></div>:null}
      {ackError?<p className="mt-2 text-xs">{ackError}</p>:null}
    </div>:null}
    <StaffToolsStyles/>
  </div>;
}
