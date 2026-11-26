import React,{useEffect,useState} from 'react';
import {hydrateRoot} from 'react-dom/client';
import {CatalogFilters} from '../../apps/web/components/catalog/CatalogFilters';
import {CatalogSidebar} from '../../apps/web/components/catalog/CatalogSidebar';
import {BrandLogoRail} from '../../apps/web/components/catalog/BrandLogoRail';
import {catalogRouteParams} from '../../apps/web/lib/catalog/catalog-routes';

const firstPageMakes=['Toyota','Nissan','Honda','Mazda','Subaru','Suzuki','Daihatsu'];
export function JapanBrandDirectoryFixture({initial:serverInitial}:{initial:Record<string,string>}){
 const [initial,setInitial]=useState(serverInitial);
 useEffect(()=>{
  const acknowledge=()=>setInitial({...Object.fromEntries(new URLSearchParams(location.search)),...catalogRouteParams(location.pathname)});
  (window as any).__japanBrandFixture.acknowledge=acknowledge;
  (window as any).__japanBrandFixture.ready=true;
  window.addEventListener('popstate',acknowledge);
  return()=>window.removeEventListener('popstate',acknowledge);
 },[]);
 const filters=<CatalogFilters initial={initial} auctionResults facets={{makes:firstPageMakes,models:[],bodyTypes:[],transmissions:[],fuels:['petrol'],drives:[]}} resultCount={24}/>;
 return <main className="ac-page-copy ac-catalog-page"><section className="ac-catalog-shell mx-auto w-full max-w-[1500px] px-4 py-6 md:px-8 md:py-10">
  <CatalogSidebar header={<h1>Автомобили из Японии</h1>} filters={filters} brandRail={<BrandLogoRail initial={initial} brands={firstPageMakes}/>}>
   <article data-fixture-card style={{height:180}}>Готовая карточка автомобиля</article>
  </CatalogSidebar>
 </section></main>;
}

if(typeof window!=='undefined'){
 const fixture={calls:[] as string[],errors:[] as string[],ready:false,acknowledge:()=>{},navigate(href:string,replace=false){
  fixture.calls.push(href);history[replace?'replaceState':'pushState'](null,'',href);queueMicrotask(()=>fixture.acknowledge());
 }};
 (window as any).__japanBrandFixture=fixture;
 hydrateRoot(document.getElementById('root')!,<JapanBrandDirectoryFixture initial={(window as any).__japanBrandInitial}/>,{onRecoverableError:error=>fixture.errors.push(String(error))});
}
