"use client";
import {useEffect} from 'react';

// Keep native Back (including the browser swipe gesture) inside the topmost
// open window before returning to the preceding route. Preserve Next's state.
export function OverlayBackHistory(){
 useEffect(()=>{
  type Step={element:HTMLElement;token:string;url:string};
  const steps:Step[]=[];
  let travelling=false,disposed=false,closing:HTMLElement|null=null;
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
    const top=steps.at(-1);
    if(top?.url===location.href&&history.state?.acOverlayStep===top.token){
     // A close button may remove a photo and its gallery together.
     travelling=true;steps.splice(steps.length-removed.length);history.go(-removed.length);return;
    }
    steps.splice(0); // Navigation to a different route already created its own step.
   }
   for(const element of elements){
    if(steps.some(step=>step.element===element))continue;
    const token=crypto.randomUUID();steps.push({element,token,url:location.href});
    history.pushState({...history.state,acOverlayStep:token},'',location.href);
   }
  };
  const pop=()=>{
   if(travelling){travelling=false;queueMicrotask(sync);return;}
   const step=steps.at(-1);
   if(step&&history.state?.acOverlayStep!==step.token){
    steps.pop();travelling=true;closing=step.element;close(step.element);
    queueMicrotask(sync);
   }
  };
  const observer=new MutationObserver(sync);
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','hidden','aria-modal','data-back-layer','class','style']});
  window.addEventListener('popstate',pop);sync();
  return()=>{disposed=true;observer.disconnect();window.removeEventListener('popstate',pop);};
 },[]);
 return null;
}
