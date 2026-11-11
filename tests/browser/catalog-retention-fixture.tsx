import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Link from 'next/link';
import {CatalogFilters} from '../../apps/web/components/catalog/CatalogFilters';
import {CatalogSidebar} from '../../apps/web/components/catalog/CatalogSidebar';
import {CatalogLoadMore} from '../../apps/web/components/catalog/CatalogLoadMore';
import {RoutePreloader} from '../../apps/web/components/layout/RoutePreloader';
import {DealerLink} from '../../apps/web/components/dealers/DealerBrowsingContext';
import {catalogRouteParams,isCatalogSearchPath} from '../../apps/web/lib/catalog/catalog-routes';
const facets={makes:['BMW','Toyota'],models:[{make:'BMW',model:'X3'},{make:'BMW',model:'X5'},{make:'Toyota',model:'Corolla'},{make:'Toyota',model:'Camry'}]};
function App(){
 const [url,setUrl]=useState(location.href);
 useEffect(()=>{const update=()=>setUrl(location.href);window.addEventListener('fixture:navigate',update);window.addEventListener('popstate',update);return()=>{window.removeEventListener('fixture:navigate',update);window.removeEventListener('popstate',update);};},[]);
 const parsed=new URL(url),initial={...Object.fromEntries(parsed.searchParams),...catalogRouteParams(parsed.pathname)},catalog=isCatalogSearchPath(parsed.pathname);
 delete initial.fixture;
 return <><RoutePreloader/><nav><Link href='/cars?market=china'>Новый каталог</Link> <Link href='/articles'>Новая статья</Link> <Link href='/articles#target'>Статья с якорем</Link></nav>{catalog?<main><h1>Каталог</h1><CatalogSidebar filters={<CatalogFilters initial={initial} facets={facets} auctionResults/>}><section id='catalog'>
 <DealerLink href='/cars?market=china&make=Toyota'>Категория Toyota</DealerLink>
 <CatalogLoadMore key={parsed.search} query={{...initial,market:'china'} as any} initialPage={1} initialCount={24} initialTotal={48} initialHasMore initialCards={Array.from({length:24},(_,i)=><article style={{minHeight:160}} key={i}><Link href='/cars/offer/sample'>Автомобиль {i}</Link></article>)}/>
 </section></CatalogSidebar></main>:<main style={{minHeight:6000}}><h1>{parsed.pathname.includes('/offer/')?'Карточка автомобиля':'Статья'}</h1><div style={{height:1500}}/><h2 id='target'>Раздел по якорю</h2><Link href='/cars?market=china'>Новый каталог внизу</Link></main>}</>;
}
createRoot(document.getElementById('root')!).render(<App/>);
