import React, {useEffect, useState} from 'react';
import {hydrateRoot} from 'react-dom/client';
import {CatalogLoadMore} from '../../apps/web/components/catalog/CatalogLoadMore';
import {RoutePreloader} from '../../apps/web/components/layout/RoutePreloader';
import CarsLayout from '../../apps/web/app/(public)/cars/layout';
import {isHistoryRoute} from '../../apps/web/lib/catalog/route-scroll';
export function App({market=typeof window === 'undefined' ? 'japan' : new URLSearchParams(window.location.search).get('market') || 'japan',initialPage=typeof window === "undefined" ? 1 : Number(new URLSearchParams(window.location.search).get("page")) || 1}:{initialPage?:number;market?:string}){
 const [detail,setDetail]=useState(false);
 useEffect(()=>{const back=()=>{(window as any).__backHistory={href:location.href,history:isHistoryRoute()};setDetail(false);};window.addEventListener('popstate',back);return()=>window.removeEventListener('popstate',back);},[]);
 return <CarsLayout><RoutePreloader/>{detail?<button onClick={()=>history.back()}>Назад</button>:<main onClick={e=>{if((e.target as Element).closest('a[href*="/cars/offer/"]')){e.preventDefault();history.pushState({},'', '/cars/offer/test');setDetail(true);}}}><h1>Каталог</h1><CatalogLoadMore query={{market:market as any}} initialPage={initialPage} initialTotal={60} initialCount={initialPage===3?12:24} initialCards={Array.from({length:initialPage===3?12:24},(_,index)=>{const i=(initialPage-1)*24+index;return <article key={i} style={{height:220,background:'#ddd',padding:12}}><a href={'/cars/offer/'+i}>Автомобиль {i+1}</a></article>})} /></main>}</CarsLayout>;
}
if (typeof document !== 'undefined') hydrateRoot(document.getElementById('root')!, <App/>, {onRecoverableError(error){throw error;}});
