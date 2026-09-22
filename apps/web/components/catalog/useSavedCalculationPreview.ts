"use client";
import {useEffect,useState} from "react";
import type {SavedCalculationPreview} from "../../lib/catalog/saved-calculation-preview";
type Value={market:string;sourceGroup:string;preview:SavedCalculationPreview}|null;
const listeners=new Map<string,Set<(value:Value)=>void>>();
const known=new Map<string,{value:Value;at:number}>();
const queued=new Set<string>();
let timer:ReturnType<typeof setTimeout>|undefined;
function queue(id:string){queued.add(id);if(!timer)timer=setTimeout(flush,0);}
async function flush(){
 timer=undefined;const ids=[...queued];queued.clear();
 for(let start=0;start<ids.length;start+=50){
  const batch=ids.slice(start,start+50);
  try{
   const response=await fetch(`/api/catalog/saved-previews?ids=${encodeURIComponent(batch.join(","))}`,{cache:"no-store",signal:AbortSignal.timeout(15000)});
   if(!response.ok)continue;
   const data=await response.json();
   for(const id of batch){if(!Object.prototype.hasOwnProperty.call(data.previews||{},id))continue;
    const value=data.previews[id] as Value;known.set(id,{value,at:Date.now()});
    for(const listener of listeners.get(id)||[])listener(value);
   }
   while(known.size>300)known.delete(known.keys().next().value!);
  }catch{/* Keep the server-rendered calculation on a temporary network error. */}
 }
}
export function invalidateSavedCalculationPreviews(){known.clear();refresh();}
function refresh(){for(const id of listeners.keys())queue(id);}
export function useSavedCalculationPreview(offer:any):SavedCalculationPreview|undefined {
 const [value,setValue]=useState<SavedCalculationPreview|undefined>(offer.savedCalculationPreview);
 useEffect(()=>{
  if(!offer.id)return;
  const receive=(entry:Value)=>{
   if(!entry){setValue(undefined);return;}
   const source=offer.sourceId||offer.sourceGroup;
   if(entry.market===offer.market && (!source||source===entry.sourceGroup))setValue(entry.preview);
  };
  if(!listeners.size){window.addEventListener("focus",refresh);window.addEventListener("avtocena:calculation-saved",refresh);}
  const set=listeners.get(offer.id)||new Set();set.add(receive);listeners.set(offer.id,set);
  const cached=known.get(offer.id);
  if(cached && Date.now()-cached.at<1000)receive(cached.value);else queue(offer.id);
  return()=>{set.delete(receive);if(!set.size)listeners.delete(offer.id);
   if(!listeners.size){window.removeEventListener("focus",refresh);window.removeEventListener("avtocena:calculation-saved",refresh);}
  };
 },[offer.id,offer.market,offer.sourceId,offer.sourceGroup]);
 return value;
}
