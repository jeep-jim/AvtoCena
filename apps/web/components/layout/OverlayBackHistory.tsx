"use client";
import {useEffect} from 'react';

// Keep native Back (including the browser swipe gesture) inside the topmost
// open window before returning to the preceding route. Preserve Next's state.
export function OverlayBackHistory(){
 useEffect(()=>{
  type Step={element:HTMLElement;token:string;url:string;scrollY:number};
  const steps:Step[]=[];
  let replacementUrl:string|null=null;
  const originalRestoration=history.scrollRestoration;
  let restoreFrame=0,restoreSecond=0;
  const pageScroll=()=>document.body.style.position==='fixed'?Math.max(0,-parseFloat(document.body.style.top)||0):window.scrollY;
  const restorePosition=(step:Step)=>{
   // Catalog sheets own unlock + layout-anchor restoration. Replaying their
   // former absolute offset here would undo it after the dealer hero collapses.
   if(step.element.matches('.ac-mobile-filter-sheet')){
    if(!steps.length)history.scrollRestoration=originalRestoration;
    return;
   }
   cancelAnimationFrame(restoreFrame);cancelAnimationFrame(restoreSecond);
   restoreFrame=requestAnimationFrame(()=>{restoreSecond=requestAnimationFrame(()=>{
    if(location.pathname===new URL(step.url).pathname&&document.body.style.position!=='fixed')window.scrollTo({top:step.scrollY,behavior:'instant'});
    if(!steps.length)history.scrollRestoration=originalRestoration;
   });});
  };
  const originalPush=history.pushState,originalReplace=history.replaceState;
  let position=Number(history.state?.acBackPosition)||0;
  originalReplace.call(history,{...history.state,acBackPosition:position},'',location.href);
  const push:History['pushState']=(data,unused,url)=>{
   const previous=location.href;
   position++;originalPush.call(history,{...data,acBackPosition:position},unused,url);
   // Applied filters can push a new query while nested pickers are still open.
   // Never restore an older replacement URL when their history entries close.
   if(steps.length&&previous!==location.href&&new URL(previous).pathname===location.pathname){
    replacementUrl=location.href;steps.forEach(step=>step.url=location.href);
   }
  };
  const replace:History['replaceState']=(data,unused,url)=>{const before=location.pathname;originalReplace.call(history,{...data,acBackPosition:position},unused,url);if(steps.length&&before===location.pathname&&history.state?.acOverlayStep===steps.at(-1)?.token){replacementUrl=location.href;steps.forEach(step=>step.url=location.href);}};
  history.pushState=push;history.replaceState=replace;
  let travelling=false,disposed=false,closing:HTMLElement|null=null;
  let restoreAfterPop:Step|null=null;
  const visible=()=>Array.from(document.querySelectorAll<HTMLElement>('dialog[open],[role="dialog"][aria-modal="true"],[data-back-layer],.ac-mobile-filter-sheet')).filter(el=>el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden');
  const close=(element:HTMLElement)=>{
   const native=element instanceof HTMLDialogElement?element:element.closest('dialog');
   if(native){if(native.dispatchEvent(new Event('cancel',{cancelable:true})))native.close();return;}
   const button=element.querySelector<HTMLButtonElement>('button[data-ac-mobile-close],button[aria-label^="Закрыть"],button[aria-label="Ко всем фотографиям"]');
   const control=button||Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(item=>/^(Закрыть|Назад|Ко всем фотографиям)$/.test(item.textContent?.trim()||''));
   if(control){control.click();return;}
   document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  };
  const sync=()=>{
   if(disposed)return;
   const elements=visible();
   if(travelling){if(closing&&!elements.includes(closing)){travelling=false;closing=null;}else return;}
   const removed=steps.filter(step=>!elements.includes(step.element));
   if(removed.length){
    // A picker can change the query and start navigation before its overlay
    // closes. Promote that changed URL to a route entry; rewinding here would
    // cancel the pending Next navigation and restore stale filter parameters.
    if(removed.length===steps.length && replacementUrl===location.href){
     const {acOverlayStep,...state}=history.state||{};
     originalReplace.call(history,state,'',location.href);
     steps.splice(0);replacementUrl=null;restorePosition(removed[0]);return;
    }
    const top=steps.at(-1);
    if(top?.url===location.href&&history.state?.acOverlayStep===top.token){
     // A close button may remove a photo and its gallery together.
     travelling=true;restoreAfterPop=removed[0];steps.splice(steps.length-removed.length);history.go(-removed.length);return;
    }
    steps.splice(0);history.scrollRestoration=originalRestoration; // Navigation to a different route already created its own step.
   }
   for(const element of elements){
    if(steps.some(step=>step.element===element))continue;
    const token=crypto.randomUUID();
    history.scrollRestoration="manual";steps.push({element,token,url:location.href,scrollY:pageScroll()});
    history.pushState({...history.state,acOverlayStep:token},'',location.href);
   }
  };
  const pop=(event:PopStateEvent)=>{
   const state=event.state;
   const nextPosition=typeof state?.acBackPosition==='number'?state.acBackPosition:position-1;
   const backwards=nextPosition<position;position=nextPosition;
   // A route opened from a dialog no longer has that dialog mounted. Skip its
   // old entries on Back so one gesture returns to the preceding page.
   if(!travelling&&!steps.length&&state?.acOverlayStep&&backwards){history.back();return;}
   if(travelling){if(replacementUrl&&new URL(replacementUrl).pathname===location.pathname){originalReplace.call(history,history.state,'',replacementUrl);}replacementUrl=null;travelling=false;if(restoreAfterPop){restorePosition(restoreAfterPop);restoreAfterPop=null;}queueMicrotask(sync);return;}
   const step=steps.at(-1);
   if(step&&history.state?.acOverlayStep!==step.token){
    steps.pop();travelling=true;closing=step.element;close(step.element);restorePosition(step);
    queueMicrotask(sync);
   }
  };
  const navigating=(event:Event)=>{
   const href=(event as CustomEvent<{href:string}>).detail?.href;
   // The dealer's canonical profile can differ from the entry URL. Closing
   // filters must not rewind into the cabinet while that route is still loading.
   if(steps.length&&href&&new URL(href,location.origin).origin===location.origin)replacementUrl=location.href;
  };
  window.addEventListener('avtocena:catalog-navigation',navigating);
  const observer=new MutationObserver(sync);
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','hidden','aria-modal','data-back-layer','class','style']});
  window.addEventListener('popstate',pop);sync();
  return()=>{disposed=true;window.removeEventListener('avtocena:catalog-navigation',navigating);cancelAnimationFrame(restoreFrame);cancelAnimationFrame(restoreSecond);history.scrollRestoration=originalRestoration;observer.disconnect();window.removeEventListener('popstate',pop);if(history.pushState===push)history.pushState=originalPush;if(history.replaceState===replace)history.replaceState=originalReplace;};
 },[]);
 return null;
}
