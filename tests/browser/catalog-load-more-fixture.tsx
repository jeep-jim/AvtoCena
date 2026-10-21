import React, {useEffect, useState} from 'react';
import {hydrateRoot} from 'react-dom/client';
import {CatalogLoadMore} from '../../apps/web/components/catalog/CatalogLoadMore';
import CarsLayout from '../../apps/web/app/(public)/cars/layout';
export function App({initialPage=typeof window === "undefined" ? 1 : Number(new URLSearchParams(window.location.search).get("page")) || 1}:{initialPage?:number}){
 const [detail,setDetail]=useState(false);
 useEffect(()=>{const back=()=>setDetail(false);window.addEventListener('popstate',back);return()=>window.removeEventListener('popstate',back);},[]);
 return <CarsLayout>{detail?<button onClick={()=>history.back()}>Назад</button>:<main onClick={e=>{if((e.target as Element).closest('a[href*="/cars/offer/"]')){e.preventDefault();history.pushState({},'', '/cars/offer/test');setDetail(true);}}}><h1>Каталог</h1><CatalogLoadMore query={{market:'japan'}} initialPage={initialPage} initialTotal={60} initialCount={initialPage===3?12:24} initialCards={Array.from({length:initialPage===3?12:24},(_,index)=>{const i=(initialPage-1)*24+index;return <article key={i} style={{height:220,background:'#ddd',padding:12}}><a href={'/cars/offer/'+i}>Автомобиль {i+1}</a></article>})} /></main>}</CarsLayout>;
}
if (typeof document !== 'undefined') hydrateRoot(document.getElementById('root')!, <App/>, {onRecoverableError(error){throw error;}});
