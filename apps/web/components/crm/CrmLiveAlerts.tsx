"use client";
import {ReminderRows} from "./Reminders";
import type {CrmReminder} from "../../lib/crm-reminders";
import type {CrmNotice} from "../../lib/crm-unified-notifications";

import { StaffHeartbeat } from "./StaffPresence";
import { CrmPushControl, unsubscribeStaffPush } from "./CrmPushControl";
import { useEffect, useRef, useState } from "react";
import { Bell, UserRound, Volume2, VolumeX, Settings, ClipboardList, ChevronDown, AlarmClock, X } from "lucide-react";
import { canMigrateLegacyAcknowledgement, type AlertLead } from "../../lib/crm-alert-state";
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
type InboxLead = AlertLead & {unread:boolean;assignmentUnread?:boolean;hasReadReceipt?:boolean;assignmentAt?:string;eventKey:string;name?:string;phone?:string;telegram?:string;car?:string;offerTitle?:string;selectedOffers?:{title:string}[]};
export function CrmLiveAlerts({userId, role="manager", displayName="Кабинет", header=false,crm=false,avatar}:{userId:string;role?:string;displayName?:string;header?:boolean;crm?:boolean;avatar?:string}) {
  const [enabled,setEnabled]=useState(false),[pending,setPending]=useState<InboxLead[]>([]),[authorized,setAuthorized]=useState(true);
  const [recent,setRecent]=useState<InboxLead[]>([]),[leadsOpen,setLeadsOpen]=useState(false);
  const [notifications,setNotifications]=useState<CrmNotice[]>([]),[reminders,setReminders]=useState<CrmReminder[]>([]),[notificationsOpen,setNotificationsOpen]=useState(false);
  const unreadNotices=notifications.filter(n=>n.unread);
  async function refreshNotices(){try{const r=await fetch('/api/crm/notifications',{cache:'no-store'});if(r.ok){const d=await r.json();setNotifications(d.notifications||[]);setReminders(d.reminders||[]);}}catch{}}
  useEffect(()=>{let busy=false;const poll=async()=>{if(busy||document.visibilityState!=='visible')return;busy=true;try{await refreshNotices();}finally{busy=false;}};void poll();const timer=setInterval(poll,20000);window.addEventListener('avtocena:reminders',poll);window.addEventListener('avtocena:crm-change',poll);document.addEventListener('visibilitychange',poll);return()=>{clearInterval(timer);window.removeEventListener('avtocena:reminders',poll);window.removeEventListener('avtocena:crm-change',poll);document.removeEventListener('visibilitychange',poll);};},[userId]);
  async function readNotices(ids:string[]){if(!ids.length)return;try{const r=await fetch('/api/crm/notifications',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ids})});if(!r.ok)throw Error();setNotifications(rows=>rows.map(n=>ids.includes(n.id)?{...n,unread:false}:n));}catch{setAckError('Не удалось отметить уведомления прочитанными.');}}
  const soundKey=`${ENABLED_KEY}_${userId}`;
  const [audioBlocked,setAudioBlocked]=useState(false);
  const [menuOpen,setMenuOpen]=useState(false),[ackError,setAckError]=useState(""),[acknowledging,setAcknowledging]=useState(false);
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
        const badges=navigator as any;
        if(next.length && badges.setAppBadge)void badges.setAppBadge(next.length).catch(()=>{});
        else if(!next.length && badges.clearAppBadge)void badges.clearAppBadge().catch(()=>{});
      }catch{}finally{busy=false;}
    };
    void poll();const timer=setInterval(()=>void poll(),20_000);
    const focus=()=>void poll();window.addEventListener("focus",focus);document.addEventListener("visibilitychange",focus);window.addEventListener("avtocena:lead-read",focus);
    const sync=(event:StorageEvent)=>{if(event.key===`avtocena_crm_read_changed_${userId}`)void poll();};window.addEventListener("storage",sync);
    return ()=>{active=false;clearInterval(timer);window.removeEventListener("focus",focus);document.removeEventListener("visibilitychange",focus);window.removeEventListener("avtocena:lead-read",focus);window.removeEventListener("storage",sync);};
  },[userId]);
  useEffect(()=>{
    if(!enabled || (!pending.length&&!unreadNotices.length) || !authorized)return;
    const ring=()=>{
      // One sound source across CRM and public tabs; the lease expires if a tab closes.
      let lease:{id?:string;until?:number}={};try{lease=JSON.parse(get(leaseKey)||"{}");}catch{}
      if(lease.id!==tab.current && Number(lease.until)>Date.now())return;
      put(leaseKey,JSON.stringify({id:tab.current,until:Date.now()+1800}));
      beep();setAudioBlocked(!audio || audio.state!=="running");
      const newest=pending[0];
      if(!newest)return;
      const eventKey=`${newest.id}:${newest.eventKey}`;
      if(document.visibilityState!=="visible" && notifiedRef.current!==eventKey && "Notification" in window && Notification.permission==="granted"){
        notifiedRef.current=eventKey;
        try{const notice=new Notification("Новые заявки · АвтоЦена",{body:newest.assignmentUnread?"Вам назначена заявка":"Непросмотренных заявок: "+pending.length,tag:`avtocena-${userId}-${eventKey}`,icon:"/logo/avtocena-mark-light.svg",requireInteraction:true});notice.onclick=()=>{window.focus();location.assign(`/crm/leads?id=${encodeURIComponent(newest.id)}`);notice.close();};}catch{}
      }
    };
    ring();const timer=setInterval(ring,1000);
    return ()=>{clearInterval(timer);try{if(JSON.parse(get(leaseKey)||"{}").id===tab.current)put(leaseKey,"{}");}catch{}};
  },[enabled,pending,notifications,authorized,leaseKey,userId]);
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
    <StaffHeartbeat/>
    <button type="button" className="ac-staff-account" aria-label={`Уведомления: ${pending.length+unreadNotices.length}`} aria-expanded={notificationsOpen} onClick={()=>{setNotificationsOpen(!notificationsOpen);setMenuOpen(false);}}><Bell size={19}/>{pending.length+unreadNotices.length>0?<span className="ac-unified-badge ac-staff-badge">{pending.length+unreadNotices.length}</span>:null}</button>
    {notificationsOpen?<section className="ac-unified-notifications" aria-label="Все уведомления"><div className="ac-notifications-heading"><strong>Уведомления</strong><button type="button" aria-label="Закрыть уведомления" onClick={()=>setNotificationsOpen(false)}><X size={20}/></button></div>
    {pending.length+unreadNotices.length>0?<button type="button" className="ac-notifications-read" onClick={()=>{void acknowledge();void readNotices(unreadNotices.map(n=>n.id));}}>Отметить прочитанными</button>:<p className="ac-notifications-empty">Новых уведомлений нет</p>}
    {pending.map(lead=><a className="ac-notification is-unread" key={lead.id} href={`/crm/leads?id=${encodeURIComponent(lead.id)}`} onClick={()=>void readRecent(lead)}><strong>{lead.assignmentUnread?'Вам назначена заявка':'Новая заявка'} · {lead.name||'Клиент'}</strong><span>{lead.offerTitle||lead.car||lead.selectedOffers?.map(o=>o.title).join(', ')||'Подбор автомобиля'}</span></a>)}
    {notifications.map(n=><div key={n.id} className={`ac-notification ${n.unread?'is-unread':''}`}>{n.href?<a href={n.href} onClick={()=>void readNotices([n.id])}><strong>{n.title}</strong><span>{n.text}</span></a>:<><strong>{n.title}</strong><span>{n.text}</span></>}{n.unread?<button type="button" onClick={()=>void readNotices([n.id])}>Прочитано</button>:null}</div>)}
    <h3 className="ac-notifications-subtitle"><AlarmClock size={17}/>Напоминания команды</h3>
    {!reminders.some(r=>Date.parse(r.dueAt)<=Date.now())?<p className="ac-notifications-empty">На сейчас напоминаний нет</p>:null}
    <ReminderRows rows={reminders.filter(r=>Date.parse(r.dueAt)<=Date.now())} onChange={()=>void refreshNotices()}/>
    {reminders.some(r=>Date.parse(r.dueAt)>Date.now())?<><h4 className="ac-notifications-subtitle">Предстоящие</h4><ReminderRows rows={reminders.filter(r=>Date.parse(r.dueAt)>Date.now())} onChange={()=>void refreshNotices()}/></>:null}
    {ackError?<p role="alert">{ackError}</p>:null}</section>:null}
    <button type="button" className="ac-staff-account" aria-label="Кабинет сотрудника" aria-expanded={menuOpen} aria-controls={`staff-menu-${userId}`} onClick={()=>{setMenuOpen(!menuOpen);setNotificationsOpen(false);}}>{avatar ? <img src={avatar} alt="" width={40} height={44} className="h-full w-full rounded-xl object-cover" referrerPolicy="no-referrer"/> : <UserRound size={21}/>}<span className="ac-staff-mobile-badge">{badge}</span></button>
    <div hidden={!menuOpen} id={`staff-menu-${userId}`} className="ac-staff-menu">
      <p className="ac-staff-name">{displayName}{crm?<small className="block text-xs font-normal">{({owner:"Владелец",admin:"Администратор",manager:"Менеджер"} as Record<string,string>)[role]||role}</small>:null}</p>
      <button type="button" onClick={()=>setLeadsOpen(!leadsOpen)} aria-expanded={leadsOpen}><ClipboardList size={18}/>Заявки{badge}<ChevronDown size={18} style={{marginLeft:'auto',transform:leadsOpen?'rotate(180deg)':undefined}}/></button>
      <button type="button" onClick={()=>{setMenuOpen(false);setNotificationsOpen(true);}}><AlarmClock size={18}/>Напоминания и уведомления{unreadNotices.length?<span className="ac-staff-badge">{unreadNotices.length}</span>:null}</button>
      {leadsOpen?<div className="ac-staff-recent">{recent.length?recent.map(lead=><details key={lead.id} onToggle={event=>{if(event.currentTarget.open)void readRecent(lead);}}><summary>{lead.unread?<i aria-label="Не просмотрена"/>:null}<span>{lead.name||'Новая заявка'}<small>{lead.offerTitle||lead.car||lead.selectedOffers?.map(o=>o.title).join(', ')||'Подбор автомобиля'}</small></span><ChevronDown size={15}/></summary><div>{lead.phone?<a href={`tel:${lead.phone.replace(/[^+0-9]/g,'')}`}>{lead.phone}</a>:null}{lead.telegram?<p>{lead.telegram}</p>:null}<a href={`/crm/leads?id=${encodeURIComponent(lead.id)}`}>Открыть заявку →</a></div></details>):<p>Заявок пока нет</p>}<a href="/crm/leads">Все заявки →</a></div>:null}
      <div className="ac-staff-menu-settings">
      <a href={crm?`/crm/managers/${encodeURIComponent(userId)}`:"/crm"}><UserRound size={18}/>{crm?"Мой профиль":"Рабочий кабинет"}</a>

      <button type="button" onClick={toggle} aria-pressed={enabled}>{enabled?<Volume2 size={18}/>:<VolumeX size={18}/>}Звук уведомлений: {enabled?"включён":"выключен"}</button>
      {enabled&&audioBlocked?<button type="button" onClick={()=>{unlockAudio();setAudioBlocked(false);}}>Разрешить воспроизведение звука</button>:null}

      {crm?<form onSubmit={event=>{event.preventDefault();const form=event.currentTarget;put(soundKey,"0");void unsubscribeStaffPush(userId).finally(()=>form.submit());}} action="/api/auth/logout?redirect=/login" method="post"><button type="submit" className="w-full min-h-11 px-2 text-left text-sm">Выйти</button></form>:null}
      <CrmPushControl userId={userId}/>
      </div>
    </div>
    {!notificationsOpen&&(pending.length>0||unreadNotices.length>0)?<div role="status" className="ac-staff-notice">
      <p className="font-bold">{pending.length?`Новые заявки: ${pending.length}`:unreadNotices[0]?.title}</p>{unreadNotices.length>0?<button className="mt-2 text-sm underline" type="button" onClick={()=>{setNotificationsOpen(true);setMenuOpen(false);}}>Открыть уведомления ({unreadNotices.length})</button>:null}
      {assignedCount>0?<p className="mt-1 text-sm">Назначено вам: {assignedCount}</p>:null}
      {enabled && audioBlocked?<button type="button" onClick={()=>{unlockAudio();setAudioBlocked(false);}} className="mt-2 text-xs underline">Нажмите, чтобы разрешить звук</button>:null}
      {pending.length>0?<div className="mt-3 flex gap-4"><a href={pending.length===1?`/crm/leads?id=${encodeURIComponent(pending[0].id)}`:"/crm/leads"} className="text-sm font-bold underline">Открыть заявки</a><button type="button" disabled={acknowledging} onClick={()=>void acknowledge()} className="text-sm underline">{acknowledging?"Сохраняем…":"Прочитано мной"}</button></div>:null}
      {ackError?<p className="mt-2 text-xs">{ackError}</p>:null}
    </div>:null}
    <style dangerouslySetInnerHTML={{__html:`
      .ac-unified-badge{position:absolute;right:-5px;top:-5px}.ac-unified-notifications{position:absolute;right:0;top:calc(100% + 12px);width:440px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 100px);overflow:auto;overscroll-behavior:contain;padding:16px;background:var(--ac-surface,#1e293b);border:1px solid var(--ac-border);border-radius:18px;z-index:145;box-shadow:0 16px 50px #0003;color:var(--ac-text)}.ac-notifications-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.ac-notifications-heading>button{width:36px;height:36px;display:grid;place-items:center}.ac-notification{display:block;padding:12px;border-radius:12px;background:var(--ac-surface-2);border:1px solid var(--ac-border);margin-top:8px;font-size:13px}.ac-notification.is-unread{border-left:3px solid #ff353d}.ac-notification strong,.ac-notification span{display:block;overflow-wrap:anywhere}.ac-notification span{margin-top:5px;color:var(--ac-muted);white-space:pre-wrap}.ac-notification>button,.ac-notifications-read{font-size:12px;text-decoration:underline;margin-top:8px;min-height:32px}.ac-notifications-empty{font-size:13px;color:var(--ac-muted);margin:10px 0}.ac-notifications-subtitle{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;margin-top:18px}.ac-unified-notifications .crm-reminder-row{display:flex;gap:10px;border-top:1px solid var(--ac-border);padding:12px 0;font-size:13px}.crm-reminder-copy{flex:1;min-width:0}.crm-reminder-copy>*{display:block;overflow-wrap:anywhere}.crm-reminder-copy time,.crm-reminder-copy small{font-size:11px;color:var(--ac-muted);margin-top:5px}.crm-reminder-row>button{flex:none;width:36px;height:36px;border-radius:10px;background:var(--ac-surface-2);display:grid;place-items:center}.ac-staff-tools--header .ac-unified-notifications{position:fixed;top:68px;right:max(24px,calc((100vw - 1500px)/2 + 32px))}@media(max-width:767px){.ac-unified-notifications,.ac-staff-tools--header .ac-unified-notifications{position:fixed;top:76px;right:12px;width:calc(100vw - 24px)}}
      .ac-staff-tools{position:relative;display:flex;align-items:center;gap:6px;color:var(--ac-text,#fff)}
      .ac-staff-leads,.ac-staff-account{display:flex;align-items:center;justify-content:center;gap:7px;height:44px;border-radius:12px;background:var(--ac-surface-2,#273343);color:inherit;font-size:12px;font-weight:700}
      .ac-staff-leads{padding:0 12px}.ac-staff-account{width:40px;position:relative}.ac-staff-mobile-badge{display:none}
      .ac-staff-tools--crm .ac-staff-mobile-badge{display:block;position:absolute;right:-4px;top:-4px}
      .ac-staff-badge{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 5px;border-radius:20px;background:#ff353d!important;color:#fff!important;-webkit-text-fill-color:#fff!important;font-size:11px}
      .ac-staff-menu,.ac-staff-notice{position:absolute;right:0;top:calc(100% + 12px);width:290px;max-width:calc(100vw - 24px);border:1px solid var(--ac-border,#526074);border-radius:16px;background:var(--ac-surface-2,#273343);color:var(--ac-text,#fff);padding:12px;z-index:130}
      .ac-staff-menu{z-index:140}.ac-staff-menu[hidden]{display:none}.ac-staff-tools--header .ac-staff-menu{position:fixed;top:68px;right:max(24px,calc((100vw - 1500px)/2 + 32px));width:470px;max-height:calc(100dvh - 84px);overflow:auto}.ac-staff-expand{width:26px}.ac-staff-recent{padding:4px 8px;max-height:320px;overflow:auto}.ac-staff-recent details{border-bottom:1px solid var(--ac-border)}.ac-staff-recent summary{display:flex;gap:8px;align-items:center;cursor:pointer;padding:10px 0;font-size:13px}.ac-staff-recent summary>span{flex:1;min-width:0}.ac-staff-recent small{display:block;font-size:11px;opacity:.7;overflow-wrap:anywhere}.ac-staff-recent i{width:7px;height:7px;border-radius:50%;background:#ff353d;flex-shrink:0}.ac-staff-recent details>div{padding-left:15px}.ac-staff-recent a{min-height:32px!important}.ac-staff-menu a,.ac-staff-menu button{display:flex;align-items:center;gap:10px;min-height:44px;width:100%;padding:8px;border-radius:8px;font-size:13px;text-align:left}.ac-staff-menu a:hover,.ac-staff-menu button:hover{background:var(--ac-surface-3,#344156)}.ac-staff-name{font-size:13px;font-weight:700;padding:6px 8px;border-bottom:1px solid var(--ac-border,#526074)}
      html[data-theme="light"] .ac-staff-menu,html[data-theme="light"] .ac-staff-notice{background:#fff!important;color:#172130!important;border-color:#ccd3de}
      .ac-staff-menu-settings{margin-top:8px;padding:6px;border-radius:12px;background:var(--ac-surface);border-top:1px solid var(--ac-border)}
      html[data-theme="light"] .ac-staff-menu-settings{background:#edf0f5}
      @media(max-width:767px){.ac-staff-tools--header .ac-staff-leads,.ac-staff-tools--header .ac-staff-expand{display:none}.ac-staff-tools--header .ac-staff-mobile-badge{display:block;position:absolute;right:-5px;top:-5px}.ac-staff-tools--header .ac-staff-menu,.ac-staff-tools--header .ac-staff-notice{position:fixed;top:70px;right:12px}.ac-staff-tools--header .ac-staff-account{width:36px}.ac-public-header .ac-icon-button,.ac-public-header .ac-favorite-nav{width:36px!important;min-width:36px!important}.ac-public-header>div{gap:6px!important;padding-left:10px!important;padding-right:10px!important}}
    `}}/>
  </div>;
}
