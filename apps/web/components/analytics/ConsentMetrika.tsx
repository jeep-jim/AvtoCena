'use client';
import {useEffect} from 'react';
import {ANALYTICS_EVENT,pageAnalyticsAllowed} from '@/lib/privacy-consent';
import {createMetrikaPageTracker,METRIKA_COUNTER_ID,METRIKA_PAGE_EVENT} from '@/lib/metrika-pageviews';

type YmQueue=((...args:unknown[])=>void)&{a?:unknown[][];l?:number};
export function ConsentMetrika(){
 useEffect(()=>{
  const tracker=createMetrikaPageTracker({
   allowed:pageAnalyticsAllowed,href:()=>location.href,referrer:()=>document.referrer,
   send:(...args)=>window.ym?.(...args),
   disable:(disabled)=>{
    (window as unknown as Record<string,unknown>)[`disableYaCounter${METRIKA_COUNTER_ID}`]=disabled;
    // Discard pending events too: refusal can happen while tag.js is still loading.
    const queue=window.ym as YmQueue|undefined;
    if(disabled&&queue?.a)queue.a=queue.a.filter(args=>args[0]!==METRIKA_COUNTER_ID);
   },
   load:()=>{
    if(!window.ym){const queue:YmQueue=(...args)=>{queue.a!.push(args);};queue.a=[];queue.l=Date.now();window.ym=queue;}
    if(document.getElementById('yandex-metrika-112098062'))return;
    const script=document.createElement('script');script.id='yandex-metrika-112098062';script.async=true;
    script.src='https://mc.yandex.ru/metrika/tag.js?id=112098062';
    script.onerror=()=>script.remove();document.head.appendChild(script);
   },
  });
  tracker.sync();
  window.addEventListener(ANALYTICS_EVENT,tracker.sync);
  window.addEventListener('storage',tracker.sync);
  window.addEventListener(METRIKA_PAGE_EVENT,tracker.sync);
  return()=>{
   tracker.stop();window.removeEventListener(ANALYTICS_EVENT,tracker.sync);
   window.removeEventListener('storage',tracker.sync);window.removeEventListener(METRIKA_PAGE_EVENT,tracker.sync);
  };
 },[]);
 return null;
}
