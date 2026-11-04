'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {Bell,ClipboardList,LogOut,UserRound} from 'lucide-react';
import {StaffHeartbeat} from '../crm/StaffPresence';
import {StaffToolsStyles} from '../crm/StaffToolsStyles';
import {StartDealerSelection} from './StartDealerSelection';
import {defaultManagerAvatar} from '@/lib/default-avatars';
export function DealerAccountMenu({user,newLeads=0}:{newLeads?:number;user:{id:string;displayName:string;avatarUrl?:string;companyId?:string;canCreateSelection?:boolean}}){
 const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  if(!open)return;
  const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus();}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
 },[open]);
 return <div className="ac-staff-tools ac-staff-tools--header" ref={root}>
  <StaffToolsStyles/><StaffHeartbeat endpoint="/api/dealers/presence"/>
  <Link href="/dealer-cabinet/leads?manager=unassigned" className="ac-staff-account" aria-label={`Заявки без ответственного: ${newLeads}`}><Bell size={21}/>{newLeads>0&&<span className="ac-staff-badge ac-unified-badge">{newLeads>99?'99+':newLeads}</span>}</Link>
  <button ref={trigger} type="button" className="ac-staff-account" aria-label="Кабинет сотрудника" aria-expanded={open} aria-controls="dealer-account-menu" onClick={()=>setOpen(!open)}><img src={user.avatarUrl||defaultManagerAvatar(user.id)} alt="" width={40} height={44} className="h-full w-full rounded-xl object-cover"/></button>
  {open&&<div id="dealer-account-menu" className="ac-staff-menu">
   <p className="ac-staff-name">{user.displayName}</p>
   <Link href="/dealer-cabinet/profile"><UserRound size={18}/>Мой профиль</Link>
   <Link href="/dealer-cabinet/overview"><ClipboardList size={18}/>Рабочий кабинет</Link>
   {user.companyId&&<StartDealerSelection menu dealerId={user.companyId} href={`/dealers/${encodeURIComponent(user.companyId)}`}/>}
   <form action="/api/auth/logout?redirect=/login" method="post"><button type="submit"><LogOut size={18}/>Выйти</button></form>
  </div>}
 </div>;
}
