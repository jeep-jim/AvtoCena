'use client';
import {CrmNavigationLinks} from './CrmNavigationLinks';
import {useEffect,useState} from 'react';
const shortLabels:Record<string,string>={'Команда и права':'Команда','Рынки и расчёт':'Рынки'};
export function CrmNavigation({links,activeHref,userId}:{links:Array<readonly [string,string]>;activeHref:string;userId:string}){
 const [counts,setCounts]=useState<Record<string,number>>({});
 useEffect(()=>{
  let stopped=false,running=false,acknowledged=false;
  const controller=new AbortController();
  const load=async()=>{if(running||document.hidden||stopped)return;running=true;try{
   const r=await fetch('/api/crm/navigation',{cache:'no-store',signal:controller.signal});if(!r.ok)return;
   const data=await r.json();if(stopped)return;setCounts(data.counts);
   if(!acknowledged&&activeHref in data.counts){
    const result=await fetch('/api/crm/navigation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({section:activeHref,through:data.through}),signal:controller.signal});
    if(result.ok&&!stopped){acknowledged=true;setCounts(v=>({...v,[activeHref]:data.persistentCounts?.[activeHref]||0}));}
   }
  }catch{}finally{running=false;}};
  void load();const timer=setInterval(load,60000);
  window.addEventListener('avtocena:crm-change',load);window.addEventListener('focus',load);document.addEventListener('visibilitychange',load);
  return()=>{stopped=true;controller.abort();clearInterval(timer);window.removeEventListener('avtocena:crm-change',load);window.removeEventListener('focus',load);document.removeEventListener('visibilitychange',load);};
 },[activeHref,userId]);
 return <CrmNavigationLinks links={links.map(([href,label])=>[href,shortLabels[label]||label] as const)} activeHref={activeHref} counts={counts}/>;
}
