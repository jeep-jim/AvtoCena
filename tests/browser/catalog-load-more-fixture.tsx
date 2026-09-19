import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CatalogLoadMore} from '../../apps/web/components/catalog/CatalogLoadMore';
function App(){
 const [detail,setDetail]=useState(false);
 useEffect(()=>{const back=()=>setDetail(false);window.addEventListener('popstate',back);return()=>window.removeEventListener('popstate',back);},[]);
 return detail?<button onClick={()=>history.back()}>Назад</button>:<main onClick={e=>{if((e.target as Element).closest('a')){e.preventDefault();history.pushState({},'', '/cars/offer/test');setDetail(true);}}}><h1>Каталог</h1><CatalogLoadMore query={{market:'japan'}} initialPage={1} initialTotal={60} initialCount={24} initialCards={Array.from({length:24},(_,i)=><article key={i} style={{height:220,background:'#ddd',padding:12}}><a href={'/cars/offer/'+i}>Автомобиль {i+1}</a></article>)} /></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
