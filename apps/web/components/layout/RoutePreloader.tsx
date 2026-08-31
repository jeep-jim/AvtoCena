"use client";

import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const START_EVENT = "avtocena:navigation-start";
const REVEAL_DELAY_MS = 100;
const MIN_VISIBLE_MS = 0;
// Object-storage cold starts can legitimately take several seconds. Hiding the
// indicator after three seconds exposed the unchanged catalog immediately
// before the offer route committed, which looked like a failed first tap.
const MAX_VISIBLE_MS = 15000;

const publicLayoutFixes = `
button[aria-label^="Почему есть фильтр"],
.ac-budget-help,
main.ac-home-page #form>div:first-child button:first-of-type{
  display:inline-grid!important;
  width:32px!important;
  height:32px!important;
  min-width:32px!important;
  min-height:32px!important;
  place-items:center!important;
  padding:0!important;
  border:0!important;
  outline:0!important;
  box-shadow:none!important;
  border-radius:999px!important;
  background:rgba(255,255,255,.14)!important;
  background-color:rgba(255,255,255,.14)!important;
  color:var(--ac-text)!important;
  backdrop-filter:blur(14px)!important;
  -webkit-backdrop-filter:blur(14px)!important;
}
html[data-theme="light"] button[aria-label^="Почему есть фильтр"],
html[data-theme="light"] .ac-budget-help,
html[data-theme="light"] main.ac-home-page #form>div:first-child button:first-of-type{
  background:rgba(196,204,218,.72)!important;
  background-color:rgba(196,204,218,.72)!important;
  color:#5f697a!important;
}
.ac-results-edit summary{list-style:none!important}.ac-results-edit summary::-webkit-details-marker{display:none!important}
.ac-results-catalog-link,.ac-results-market-link{background:var(--ac-surface)!important;color:var(--ac-text)!important;-webkit-text-fill-color:var(--ac-text)!important}
html[data-theme="light"] .ac-results-catalog-link,html[data-theme="light"] .ac-results-market-link,html[data-theme="light"] .ac-catalog-pagination a:not(.ac-pagination-current){background:#fff!important;color:#171b24!important;-webkit-text-fill-color:#171b24!important}
.ac-catalog-nav-icon{position:relative!important;display:inline-flex!important;width:24px!important;height:24px!important;align-items:center!important;justify-content:center!important}
.ac-catalog-nav-icon svg{display:none!important}
.ac-catalog-nav-icon:before{content:"";position:absolute;left:3px;top:3px;width:14px;height:14px;border:2px solid currentColor;border-radius:999px;box-sizing:border-box}
.ac-catalog-nav-icon:after{content:"";position:absolute;left:15px;top:15px;width:7px;height:2px;border-radius:999px;background:currentColor;transform:rotate(45deg);transform-origin:left center}

/* Dark controls keep the original translucent surface instead of a solid black tile. */
.ac-home-page #form .ac-filter-control,
.ac-home-filter-drawer .ac-filter-control,
.ac-catalog-filter-panel .ac-filter-control,
.ac-catalog-filter-drawer .ac-filter-control,
.ac-results-edit-form .ac-filter-control{
  background:rgba(255,255,255,.072)!important;
  background-color:rgba(255,255,255,.072)!important;
  background-image:none!important;
  border:0!important;
  outline:0!important;
  box-shadow:none!important;
}
html[data-theme="light"] .ac-home-page #form .ac-filter-control,
html[data-theme="light"] .ac-home-filter-drawer .ac-filter-control,
html[data-theme="light"] .ac-catalog-filter-panel .ac-filter-control,
html[data-theme="light"] .ac-catalog-filter-drawer .ac-filter-control,
html[data-theme="light"] .ac-results-edit-form .ac-filter-control{
  background:var(--ac-surface-2)!important;
  background-color:var(--ac-surface-2)!important;
}
.ac-electric-filter,.ac-power-limit{
  box-sizing:border-box!important;
  height:56px!important;
  min-height:56px!important;
  gap:12px!important;
  padding-top:0!important;
  padding-bottom:0!important;
  padding-left:16px!important;
  border-radius:16px!important;
  align-items:center!important;
}
.ac-electric-filter{padding-right:16px!important}
.ac-power-limit{padding-right:56px!important}
.ac-results-edit-form .ac-power-limit{padding-right:16px!important}
.ac-electric-filter>span:first-of-type,
.ac-power-limit>span:first-of-type,
.ac-filter-checkbox-mark{
  display:flex!important;
  width:24px!important;
  height:24px!important;
  min-width:24px!important;
  min-height:24px!important;
  flex:0 0 24px!important;
  align-items:center!important;
  justify-content:center!important;
  box-sizing:border-box!important;
  margin:0!important;
  border:1px solid rgba(255,255,255,.22)!important;
  border-radius:8px!important;
  background:transparent!important;
  color:transparent!important;
  line-height:1!important;
}
html[data-theme="light"] .ac-electric-filter>span:first-of-type,
html[data-theme="light"] .ac-power-limit>span:first-of-type,
html[data-theme="light"] .ac-filter-checkbox-mark{
  border-color:rgba(35,42,55,.18)!important;
  background:transparent!important;
}
.ac-electric-filter>span:first-of-type{font-size:0!important}
.ac-electric-filter>span:nth-of-type(2){display:none!important}
.ac-electric-filter:has(input:checked)>span:first-of-type{
  border-color:#ffd21f!important;
  background:#ffd21f!important;
  color:transparent!important;
}
.ac-electric-filter:has(input:checked)>span:first-of-type::before{
  content:""!important;
  display:block!important;
  width:9px!important;
  height:15px!important;
  background:#05070b!important;
  clip-path:polygon(58% 0,8% 56%,43% 56%,28% 100%,92% 39%,57% 39%)!important;
}
.ac-power-limit:has(input:checked)>span:first-of-type{
  border-color:#ff353d!important;
  background:#ff353d!important;
  color:#fff!important;
}
body:has(main.ac-home-page) .z-\\[15020\\] section>div:nth-child(2)>div:first-child>div:first-child{display:none!important}
body:has(main.ac-home-page) .z-\\[15020\\] section>div:nth-child(2) h2{margin-top:0!important}
@media(min-width:768px){
  html body main.ac-home-page #form .ac-budget-help{display:none!important}
}
/* Route loading occupies exactly the same 64px as the public header.
   Use plain straight diagonal bands; the oversized stripe sheet moves only
   on the X axis, so the visual direction is unambiguously left to right. */
.ac-route-loader{
  height:64px!important;
  min-height:64px!important;
  max-height:64px!important;
  overflow:hidden!important;
  background:rgba(15,23,42,.10)!important;
  isolation:isolate!important;
  clip-path:inset(0)!important;
  contain:paint!important;
}
.ac-route-loader__candy{
  position:absolute!important;
  top:0!important;
  bottom:0!important;
  left:-64px!important;
  right:-64px!important;
  height:64px!important;
  background:repeating-linear-gradient(120deg,#ff353d 0 34px,#fff 34px 52px)!important;
  opacity:.58!important;
  animation:ac-route-candy-sweep .86s linear infinite!important;
  will-change:transform!important;
  box-shadow:inset 0 -1px 0 rgba(0,0,0,.18)!important;
}
.ac-route-loader__candy::after{
  content:none!important;
}
.ac-route-loader__label{
  position:absolute!important;
  left:50%!important;
  top:50%!important;
  z-index:1!important;
  transform:translate(-50%,-50%)!important;
  max-width:calc(100vw - 32px)!important;
  white-space:nowrap!important;
  border:1px solid rgba(255,255,255,.30)!important;
  border-radius:999px!important;
  background:rgba(12,18,30,.56)!important;
  color:#fff!important;
  -webkit-text-fill-color:#fff!important;
  padding:7px 13px!important;
  font-size:12px!important;
  font-weight:900!important;
  line-height:1!important;
  letter-spacing:.04em!important;
  box-shadow:0 3px 10px rgba(0,0,0,.16)!important;
  backdrop-filter:blur(5px)!important;
  -webkit-backdrop-filter:blur(5px)!important;
}
@keyframes ac-route-candy-sweep{
  from{transform:translate3d(-60px,0,0)}
  to{transform:translate3d(0,0,0)}
}
@media(max-width:420px){
  .ac-route-loader__label{padding:6px 10px!important;font-size:11px!important}
}
@media(prefers-reduced-motion:reduce){
  .ac-route-loader__candy{animation:none!important}
}
@media(max-width:1023px){
.ac-home-page #form>div.relative.mt-4{position:relative!important;display:flex!important;align-items:stretch!important;gap:8px!important;overflow:visible!important}
.ac-home-page #form>div.relative.mt-4>.avto-button{display:flex!important;flex:1 1 auto!important;width:auto!important;min-width:0!important;align-items:center!important;justify-content:center!important;padding-right:1rem!important;text-align:center!important}
html body main.ac-home-page #form>div.relative.mt-4>button[aria-label="Открыть дополнительные фильтры"]{position:static!important;inset:auto!important;display:flex!important;flex:0 0 58px!important;width:58px!important;height:58px!important;align-items:center!important;justify-content:center!important;border:0!important;outline:0!important;border-radius:1rem!important;background:rgba(255,255,255,.072)!important;background-color:rgba(255,255,255,.072)!important;color:var(--ac-text)!important}
html[data-theme="light"] body main.ac-home-page #form>div.relative.mt-4>button[aria-label="Открыть дополнительные фильтры"]{background:var(--ac-surface-2)!important;background-color:var(--ac-surface-2)!important}
.ac-home-filter-drawer button[aria-label="Открыть дополнительные фильтры"],.ac-home-filter-drawer .ac-filter-more-button,.ac-home-filter-drawer div:has(>.avto-button)>button:not(.avto-button){display:none!important}
}
@media(max-width:767px){
  html body main.ac-home-page #form>div:nth-child(2),
  html body .ac-home-filter-drawer__fields>div:nth-child(2){
    display:grid!important;
    grid-template-columns:repeat(2,minmax(0,1fr))!important;
    align-items:stretch!important;
    gap:10px!important;
  }
  html body main.ac-home-page #form>div:nth-child(2)>*,
  html body .ac-home-filter-drawer__fields>div:nth-child(2)>*{
    min-width:0!important;
    width:100%!important;
    height:56px!important;
    min-height:56px!important;
  }
  html body .ac-electric-filter,
  html body .ac-power-limit{
    gap:12px!important;
    padding-left:16px!important;
  }
  html body .ac-electric-filter>span:first-of-type,
  html body .ac-power-limit>span:first-of-type{
    width:24px!important;
    height:24px!important;
    min-width:24px!important;
    min-height:24px!important;
    flex-basis:24px!important;
  }
  html body .ac-electric-filter>span:last-child{
    min-width:0!important;
    overflow:visible!important;
    text-overflow:clip!important;
    white-space:nowrap!important;
  }

  /* Compact homepage drawer: pair year and market, keep the main groups full width. */
  html body .ac-home-filter-drawer .ac-home-filter-drawer__fields{
    display:grid!important;
    grid-template-columns:repeat(2,minmax(0,1fr))!important;
    gap:10px!important;
  }
  html body .ac-home-filter-drawer .ac-home-filter-drawer__fields>*{
    min-width:0!important;
    width:100%!important;
    margin:0!important;
  }
  html body .ac-home-filter-drawer .ac-home-filter-drawer__fields>:nth-child(1),
  html body .ac-home-filter-drawer .ac-home-filter-drawer__fields>:nth-child(2),
  html body .ac-home-filter-drawer .ac-home-filter-drawer__fields>:nth-child(3),
  html body .ac-home-filter-drawer .ac-home-filter-drawer__fields>:nth-child(4),
  html body .ac-home-filter-drawer .ac-home-filter-drawer__fields>:nth-child(n+7){
    grid-column:1/-1!important;
  }

  /* Compact catalog drawer: pair selects and keep numeric ranges readable. */
  html body .ac-catalog-filter-drawer>div.grid.gap-3>div:nth-child(3){
    display:grid!important;
    grid-template-columns:repeat(2,minmax(0,1fr))!important;
    gap:10px!important;
  }
  html body .ac-catalog-filter-drawer>div.grid.gap-3>div:nth-child(3)>*{
    min-width:0!important;
    width:100%!important;
  }
  html body .ac-catalog-filter-drawer>div.grid.gap-3>div:nth-child(3)>.ac-filter-range,
  html body .ac-catalog-filter-drawer>div.grid.gap-3>div:nth-child(3)>div:has(input[name="transmission"]){
    grid-column:1/-1!important;
  }
}
`;

export function startRoutePreloader(){if(typeof window!=="undefined")window.dispatchEvent(new Event(START_EVENT));}
function sameDocumentHashNavigation(anchor:HTMLAnchorElement,url:URL){return url.pathname===window.location.pathname&&url.search===window.location.search&&Boolean(url.hash)}

function RoutePreloaderInner(){
 const pathname=usePathname();const searchParams=useSearchParams();const router=useRouter();const [visible,setVisible]=useState(false);const [mounted,setMounted]=useState(false);
 const startedAtRef=useRef(0);const routeKey=`${pathname}?${searchParams.toString()}`;const previousRouteKeyRef=useRef(routeKey);const warmedRoutesRef=useRef(new Set<string>());const revealTimerRef=useRef<number|null>(null);const hideTimerRef=useRef<number|null>(null);const safetyTimerRef=useRef<number|null>(null);
 const clearTimers=()=>{if(revealTimerRef.current!==null)window.clearTimeout(revealTimerRef.current);if(hideTimerRef.current!==null)window.clearTimeout(hideTimerRef.current);if(safetyTimerRef.current!==null)window.clearTimeout(safetyTimerRef.current);revealTimerRef.current=null;hideTimerRef.current=null;safetyTimerRef.current=null};
 const hide=()=>{clearTimers();setVisible(false)};
 const show=()=>{clearTimers();const startedRoute=`${window.location.pathname}${window.location.search}`;revealTimerRef.current=window.setTimeout(()=>{revealTimerRef.current=null;if(`${window.location.pathname}${window.location.search}`!==startedRoute)return;startedAtRef.current=performance.now();setVisible(true);safetyTimerRef.current=window.setTimeout(()=>setVisible(false),MAX_VISIBLE_MS)},REVEAL_DELAY_MS)};
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
 useEffect(()=>setMounted(true),[]);
 useLayoutEffect(()=>{if(previousRouteKeyRef.current===routeKey)return;previousRouteKeyRef.current=routeKey;hide()},[routeKey]);
 if(!mounted)return null;
 return <div className={`ac-route-loader pointer-events-none fixed left-0 right-0 top-0 z-[2147483646] transition-opacity duration-75 ${visible?"opacity-100":"opacity-0"}`} aria-hidden={!visible} aria-live="polite" role="status"><div className="ac-route-loader__candy" aria-hidden="true"/><div className="ac-route-loader__label">Загружаем страницу</div><span className="sr-only">Загружаем страницу</span></div>;
}

export function RoutePreloader(){return <><style dangerouslySetInnerHTML={{__html:publicLayoutFixes}}/><Suspense fallback={null}><RoutePreloaderInner/></Suspense></>}
