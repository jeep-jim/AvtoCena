'use client';
import {useEffect} from 'react';
import {usePathname} from 'next/navigation';
import {ANALYTICS_EVENT,analyticsAllowed} from '@/lib/privacy-consent';
export function ConsentMetrika(){
 const privatePage=usePathname().startsWith('/privacy/request');
 useEffect(()=>{
  let active=false;
  const sync=()=>{
   const allowed=analyticsAllowed()&&!privatePage;if(allowed===active)return;active=allowed;
   if(!allowed){window.ym?.(112098062,'destruct');return;}
   if(!window.ym){const queue:any=function(...args:unknown[]){queue.a.push(args);};queue.a=[];queue.l=Date.now();window.ym=queue;}
   if(!document.getElementById('yandex-metrika-112098062')){const script=document.createElement('script');script.id='yandex-metrika-112098062';script.async=true;script.src='https://mc.yandex.ru/metrika/tag.js?id=112098062';document.head.appendChild(script);}
   window.ym(112098062,'init',{ssr:true,webvisor:false,clickmap:true,ecommerce:'dataLayer',referrer:document.referrer.split('?')[0],url:location.origin+location.pathname,accurateTrackBounce:true,trackLinks:true});
  };
  sync();window.addEventListener(ANALYTICS_EVENT,sync);window.addEventListener('storage',sync);
  return()=>{if(active)window.ym?.(112098062,'destruct');window.removeEventListener(ANALYTICS_EVENT,sync);window.removeEventListener('storage',sync);};
 },[privatePage]);
 return null;
}
