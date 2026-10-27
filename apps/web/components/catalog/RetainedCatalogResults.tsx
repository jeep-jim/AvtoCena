'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {useDealerBrowsing} from '@/components/dealers/DealerBrowsingContext';
import {CatalogUnavailable} from './CatalogUnavailable';
// Only this mounted results area holds one successful render, never a shared
// server cache or another dealer/market. It is display-only after a failure.
const RETAIN_MS=2*60*1000;
export function RetainedCatalogResults({scope,error,children}:{scope:string;error?:string;children:ReactNode}) {
 const dealer=useDealerBrowsing();scope=JSON.stringify([scope,dealer?.id||'public',Boolean(dealer?.preview)]);
 const last=useRef<{scope:string;children:ReactNode;at:number}|null>(null);
 const [,expire]=useState(0);
 useEffect(()=>{
  if(!error)last.current={scope,children,at:Date.now()};
  else if(last.current?.scope!==scope)last.current=null;
 },[scope,error,children]);
 const saved=error&&last.current?.scope===scope&&Date.now()-last.current.at<RETAIN_MS?last.current:null;
 useEffect(()=>{
  if(!error||!saved)return;
  const timer=setTimeout(()=>{last.current=null;expire(value=>value+1);},Math.max(1,RETAIN_MS-(Date.now()-saved.at)));
  return()=>clearTimeout(timer);
 },[error,saved]);
 return <>
  {error?<CatalogUnavailable retained={Boolean(saved)} message={error}/>:null}
  <div data-catalog-retained={saved?'true':undefined}>
   {error?saved?.children:children}
  </div>
  <style>{'[data-catalog-retained="true"] .ac-pagination,[data-catalog-retained="true"] .ac-catalog-more{display:none!important}'}</style>
 </>;
}
