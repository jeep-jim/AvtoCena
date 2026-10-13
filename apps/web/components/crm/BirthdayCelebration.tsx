"use client";
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {Gift,X} from 'lucide-react';
import type {BirthdayCelebration as Birthday} from '@/lib/crm-birthday-celebrations';
import './BirthdayCelebration.css';

const colors=['#ff657e','#ffc65a','#8b80ff','#52d9cf','#ff92ce','#80bcff'];
export function BirthdayCard({person,onClose}:{person:Birthday;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 const [card,setCard]=useState(false),[photoFailed,setPhotoFailed]=useState(false);
 useEffect(()=>{
  const el=dialog.current;if(!el)return;
  const previous=document.activeElement as HTMLElement|null;
  const overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';el.showModal();
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const timer=window.setTimeout(()=>setCard(true),reduced?0:3000);
  return()=>{clearTimeout(timer);el.close();document.body.style.overflow=overflow;previous?.focus?.();};
 },[]);
 return createPortal(<dialog ref={dialog} className={`crm-birthday-overlay ${card?'is-card':'is-balloons'}`} aria-labelledby="crm-birthday-title" aria-describedby="crm-birthday-message" onCancel={event=>{event.preventDefault();onClose();}}>
  <button className="crm-birthday-close" type="button" aria-label="Закрыть поздравление" onClick={onClose} autoFocus><X size={26}/></button>
  <div className="crm-birthday-glow" aria-hidden="true"/>
  <div className="crm-birthday-confetti" aria-hidden="true">{Array.from({length:28},(_,i)=><i key={i} style={{'--x':`${(i*37+3)%100}%`,'--y':`${(i*23+5)%100}%`,'--color':colors[i%colors.length],'--turn':`${i*29}deg`} as CSSProperties}/>)}</div>
  {!card?<div className="crm-birthday-balloons" aria-hidden="true">{Array.from({length:16},(_,i)=><div className="crm-birthday-balloon" key={i} style={{'--x':`${(i*17+3)%100}%`,'--color':colors[i%colors.length],'--delay':`${(i%5)*.12}s`,'--size':`${74+(i%4)*19}px`,'--sway':`${i%2?40:-40}px`} as CSSProperties}><span/></div>)}</div>:null}
  <section className="crm-birthday-card" aria-live="polite">
   <p className="crm-birthday-eyebrow">Сегодня твой день</p>
   <div className="crm-birthday-portrait">{person.avatarUrl&&!photoFailed?<img src={person.avatarUrl} alt={person.name} onError={()=>setPhotoFailed(true)}/>:<Gift size={76} strokeWidth={1.25} aria-hidden="true"/>}<span aria-hidden="true">✦</span></div>
   <h2 id="crm-birthday-title">{person.name}!</h2>
   <p id="crm-birthday-message" className="crm-birthday-wishes">Мы все тебя поздравляем!</p>
   <p className="crm-birthday-heading">С Днём Рождения!</p>
   <p className="crm-birthday-signature">С теплом, твоя команда <span>АвтоЦена</span></p>
  </section>
 </dialog>,document.body);
}

export function BirthdayCelebration({birthdays}:{birthdays:Birthday[]}){
 const [active,setActive]=useState<Birthday|null>(null);
 const busy=useRef(false),attempted=useRef(new Set<string>());
 useEffect(()=>{
  if(active||busy.current||document.visibilityState!=='visible'||!/^\/crm(?:\/|$)/.test(location.pathname))return;
  const next=birthdays.find(row=>!attempted.current.has(row.id));if(!next)return;
  busy.current=true;
  void fetch('/api/crm/birthdays/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:next.id})})
   .then(async response=>{if(!response.ok)return;const data=await response.json();attempted.current.add(next.id);if(data.celebration)setActive(data.celebration);})
   .catch(()=>{}).finally(()=>{busy.current=false;});
 },[birthdays,active]);
 return active?<BirthdayCard key={active.id} person={active} onClose={()=>setActive(null)}/>:null;
}
