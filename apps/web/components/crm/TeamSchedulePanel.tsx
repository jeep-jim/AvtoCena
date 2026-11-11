'use client';
import {useEffect,useRef,useState} from 'react';
import {CalendarDays,ChevronDown} from 'lucide-react';
import {TeamSchedule} from './TeamSchedule';
export function TeamSchedulePanel({initialMonth,initialDate}:{initialMonth?:string;initialDate?:string}){
 const [open,setOpen]=useState(Boolean(initialMonth||initialDate)),[visited,setVisited]=useState(Boolean(initialMonth||initialDate));const root=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{const reveal=()=>{if(location.hash==='#team-schedule'){setOpen(true);setVisited(true);requestAnimationFrame(()=>root.current?.scrollIntoView({block:'start'}));}};reveal();window.addEventListener('hashchange',reveal);return()=>window.removeEventListener('hashchange',reveal);},[]);
 return <details ref={root} className="crm-team-schedule-panel glass" open={open} onToggle={e=>{setOpen(e.currentTarget.open);if(e.currentTarget.open)setVisited(true);}}><summary><CalendarDays size={21}/><span>Рабочий график<small>Смены и места работы команды</small></span><ChevronDown size={20}/></summary>{visited?<TeamSchedule initialMonth={initialMonth} initialDate={initialDate}/>:null}</details>;
}
