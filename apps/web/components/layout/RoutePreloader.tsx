"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BrandMark } from "@/components/brand/BrandMark";

const START_EVENT = "avtocena:navigation-start";
const MIN_VISIBLE_MS = 260;
const MAX_VISIBLE_MS = 8000;

const publicLayoutFixes = `
button[aria-label^="Почему есть фильтр"]{border:0!important;outline:0!important;box-shadow:none!important}
.ac-results-edit summary{list-style:none!important}.ac-results-edit summary::-webkit-details-marker{display:none!important}
.ac-results-catalog-link,.ac-results-market-link{background:var(--ac-surface)!important;color:var(--ac-text)!important;-webkit-text-fill-color:var(--ac-text)!important}
html[data-theme="light"] .ac-results-catalog-link,html[data-theme="light"] .ac-results-market-link,html[data-theme="light"] .ac-catalog-pagination a:not(.ac-pagination-current){background:#fff!important;color:#171b24!important;-webkit-text-fill-color:#171b24!important}
.ac-catalog-nav-icon{position:relative!important;display:inline-flex!important;width:24px!important;height:24px!important;align-items:center!important;justify-content:center!important}
.ac-catalog-nav-icon svg{display:none!important}
.ac-catalog-nav-icon:before{content:"";position:absolute;left:3px;top:3px;width:14px;height:14px;border:2px solid currentColor;border-radius:999px;box-sizing:border-box}
.ac-catalog-nav-icon:after{content:"";position:absolute;left:15px;top:15px;width:7px;height:2px;border-radius:999px;background:currentColor;transform:rotate(45deg);transform-origin:left center}

/* All public filter rows use one surface, radius and left alignment. */
.ac-home-page #form .ac-filter-control,
.ac-home-filter-drawer .ac-filter-control,
.ac-catalog-filter-panel .ac-filter-control,
.ac-catalog-filter-drawer .ac-filter-control,
.ac-results-edit-form .ac-filter-control{
  background:var(--ac-surface-2)!important;
  background-color:var(--ac-surface-2)!important;
  background-image:none!important;
  border:0!important;
  outline:0!important;
  box-shadow:none!important;
}
.ac-electric-filter,.ac-power-limit{
  box-sizing:border-box!important;
  height:56px!important;
  min-height:56px!important;
  gap:12px!important;
  padding:0 16px!important;
  border-radius:16px!important;
}
.ac-power-limit{padding-right:56px!important}
.ac-electric-filter>span:first-of-type,
.ac-power-limit>span:first-of-type,
.ac-filter-checkbox-mark{
  display:flex!important;
  width:24px!important;
  height:24px!important;
  flex:0 0 24px!important;
  align-items:center!important;
  justify-content:center!important;
  box-sizing:border-box!important;
  border:1px solid rgba(255,255,255,.22)!important;
  border-radius:8px!important;
  background:var(--ac-surface-2)!important;
  color:transparent!important;
  line-height:1!important;
}
html[data-theme="light"] .ac-electric-filter>span:first-of-type,
html[data-theme="light"] .ac-power-limit>span:first-of-type,
html[data-theme="light"] .ac-filter-checkbox-mark{
  border-color:rgba(35,42,55,.18)!important;
  background:var(--ac-surface-2)!important;
}
.ac-electric-filter:has(input:checked)>span:first-of-type{
  border-color:#ffd21f!important;
  background:#ffd21f!important;
  color:#171a21!important;
}
.ac-power-limit:has(input:checked)>span:first-of-type{
  border-color:#ff353d!important;
  background:#ff353d!important;
  color:#fff!important;
}
.ac-budget-help{
  border:0!important;
  outline:0!important;
  box-shadow:none!important;
}
@media(min-width:1024px){
  html body main.ac-home-page #form .ac-budget-help{display:none!important}
}
@media(max-width:1023px){
.ac-home-page #form>div.relative.mt-4{position:relative!important;display:flex!important;align-items:stretch!important;gap:8px!important;overflow:visible!important}
.ac-home-page #form>div.relative.mt-4>.avto-button{display:flex!important;flex:1 1 auto!important;width:auto!important;min-width:0!important;align-items:center!important;justify-content:center!important;padding-right:1rem!important;text-align:center!important}
html body main.ac-home-page #form>div.relative.mt-4>button[aria-label="Открыть дополнительные фильтры"]{position:static!important;inset:auto!important;display:flex!important;flex:0 0 58px!important;width:58px!important;height:58px!important;align-items:center!important;justify-content:center!important;border:0!important;outline:0!important;border-radius:1rem!important;background:var(--ac-surface-2)!important;background-color:var(--ac-surface-2)!important;color:var(--ac-text)!important}
.ac-home-filter-drawer button[aria-label="Открыть дополнительные фильтры"],.ac-home-filter-drawer .ac-filter-more-button,.ac-home-filter-drawer div:has(>.avto-button)>button:not(.avto-button){display:none!important}
}
`;

export function startRoutePreloader(){if(typeof window!=="undefined")window.dispatchEvent(new Event(START_EVENT));}
function sameDocumentHashNavigation(anchor:HTMLAnchorElement,url:URL){return url.pathname===window.location.pathname&&url.search===window.location.search&&Boolean(url.hash)}

function RoutePreloaderInner(){
 const pathname=usePathname();const searchParams=useSearchParams();const router=useRouter();const [visible,setVisible]=useState(false);
 const startedAtRef=useRef(0);const routeKey=`${pathname}?${searchParams.toString()}`;const previousRouteKeyRef=useRef(routeKey);const warmedRoutesRef=useRef(new Set<string>());const hideTimerRef=useRef<number|null>(null);const safetyTimerRef=useRef<number|null>(null);
 const clearTimers=()=>{if(hideTimerRef.current!==null)window.clearTimeout(hideTimerRef.current);if(safetyTimerRef.current!==null)window.clearTimeout(safetyTimerRef.current);hideTimerRef.current=null;safetyTimerRef.current=null};
 const show=()=>{clearTimers();startedAtRef.current=performance.now();setVisible(true);safetyTimerRef.current=window.setTimeout(()=>setVisible(false),MAX_VISIBLE_MS)};
 useEffect(()=>{
  const handleStart=()=>show();
  const handleClick=(event:MouseEvent)=>{
   if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
   const target=event.target instanceof Element?event.target:null;
   const button=target?.closest("button") as HTMLButtonElement|null;
   if(button&&!button.disabled&&/Узнать\s+Цену/i.test(button.textContent||"")){show();return;}
   const anchor=target?.closest("a[href]") as HTMLAnchorElement|null;
   if(!anchor||anchor.target==="_blank"||anchor.hasAttribute("download"))return;
   const url=new URL(anchor.href,window.location.href);
   if(url.origin!==window.location.origin||sameDocumentHashNavigation(anchor,url))return;
   if(`${window.location.pathname}${window.location.search}`===`${url.pathname}${url.search}`)return;
   show();
  };
  const handleSubmit=(event:SubmitEvent)=>{const form=event.target as HTMLFormElement|null;if(!form||form.dataset.noRouteLoader==="true"||form.target==="_blank")return;show()};
  const warm=(event:Event)=>{const anchor=(event.target as Element|null)?.closest("a[href]") as HTMLAnchorElement|null;if(!anchor)return;const url=new URL(anchor.href,window.location.href);if(url.origin!==window.location.origin||sameDocumentHashNavigation(anchor,url))return;const route=`${url.pathname}${url.search}`;if(warmedRoutesRef.current.has(route))return;warmedRoutesRef.current.add(route);router.prefetch(route)};
  window.addEventListener(START_EVENT,handleStart);document.addEventListener("click",handleClick,true);document.addEventListener("submit",handleSubmit,true);document.addEventListener("pointerover",warm,true);document.addEventListener("focusin",warm,true);
  return()=>{window.removeEventListener(START_EVENT,handleStart);document.removeEventListener("click",handleClick,true);document.removeEventListener("submit",handleSubmit,true);document.removeEventListener("pointerover",warm,true);document.removeEventListener("focusin",warm,true);clearTimers()};
 },[router]);
 useEffect(()=>{if(previousRouteKeyRef.current===routeKey)return;previousRouteKeyRef.current=routeKey;if(!visible)return;const delay=Math.max(0,MIN_VISIBLE_MS-(performance.now()-startedAtRef.current));hideTimerRef.current=window.setTimeout(()=>{setVisible(false);clearTimers()},delay)},[routeKey,visible]);
 return <div className={`ac-route-loader fixed inset-0 z-[2147483646] grid place-items-center bg-[#080a11]/88 px-6 backdrop-blur-xl transition-opacity duration-200 ${visible?"pointer-events-auto opacity-100":"pointer-events-none opacity-0"}`} aria-hidden={!visible} aria-live="polite"><div className="flex flex-col items-center text-center"><div className="ac-route-loader__mark relative grid h-24 w-24 place-items-center rounded-[2rem] border border-white/12 bg-white/[0.06]"><BrandMark className="h-16 w-16"/></div><div className="mt-5 grid grid-cols-4 gap-2" aria-hidden="true">{["+","−","=","₽"].map((symbol,index)=><span key={symbol} className="ac-route-loader__key grid h-9 w-9 place-items-center rounded-xl border border-white/12 bg-white/[0.075] text-base font-black text-white" style={{animationDelay:`${index*150}ms`}}>{symbol}</span>)}</div><div className="mt-4 text-sm font-black text-white">Подбираем автомобили</div><div className="mt-1 text-xs font-bold text-white/45">АвтоЦена загружает подходящие варианты</div></div></div>;
}

export function RoutePreloader(){return <><style dangerouslySetInnerHTML={{__html:publicLayoutFixes}}/><Suspense fallback={null}><RoutePreloaderInner/></Suspense></>}
