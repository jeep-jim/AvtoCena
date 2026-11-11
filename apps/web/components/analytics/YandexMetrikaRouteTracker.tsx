"use client";
import {rememberYandexClick} from '@/lib/metrika-client';
import {METRIKA_PAGE_EVENT} from '@/lib/metrika-pageviews';
import {Suspense,useEffect} from 'react';
import {usePathname,useSearchParams} from 'next/navigation';

declare global {interface Window {ym?:(...args:unknown[])=>void;}}

function RouteTracker(){
 const pathname=usePathname();
 const query=useSearchParams().toString();
 useEffect(()=>{
  // CRM attribution still requires explicit consent inside rememberYandexClick.
  rememberYandexClick();
  window.dispatchEvent(new Event(METRIKA_PAGE_EVENT));
 },[pathname,query]);
 return null;
}
export function YandexMetrikaRouteTracker(){return <Suspense fallback={null}><RouteTracker /></Suspense>;}
