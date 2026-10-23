"use client";
import {createPortal} from 'react-dom';
import {useEffect,useState} from 'react';

/** Tied to the actual transition, with no timer that hides an unfinished request. */
export function CatalogFilterPending({pending}:{pending:boolean}){
 const [mounted,setMounted]=useState(false);
 useEffect(()=>setMounted(true),[]);
 return <><span hidden data-catalog-pending={pending?'true':'false'}/>{mounted&&pending?createPortal(
  <div className="ac-catalog-filter-header-loading ac-route-loader pointer-events-none fixed inset-x-0 top-0 z-[2147483646] lg:hidden" role="status" aria-live="polite">
   <span className="ac-route-loader__candy" aria-hidden="true"/>
   <span className="ac-route-loader__label">Обновляем автомобили</span>
  </div>,document.body):null}</>;
}
