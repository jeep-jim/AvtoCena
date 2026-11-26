import React,{useEffect,useState} from 'react';
import {hydrateRoot} from 'react-dom/client';
import {CatalogFilters} from '../../apps/web/components/catalog/CatalogFilters';
import {CatalogSelectionProvider} from '../../apps/web/components/catalog/CatalogSelectionContext';
import {catalogRouteParams} from '../../apps/web/lib/catalog/catalog-routes';

export function JapanCityFixture({initial:serverInitial}:{initial:Record<string,string>}){
 const [initial,setInitial]=useState(serverInitial);
 useEffect(()=>{
  const acknowledge=()=>setInitial({...Object.fromEntries(new URLSearchParams(location.search)),...catalogRouteParams(location.pathname)});
  (window as any).__japanCityFixture.acknowledge=acknowledge;
  (window as any).__japanCityFixture.ready=true;
  window.addEventListener('popstate',acknowledge);
  return()=>window.removeEventListener('popstate',acknowledge);
 },[]);
 return <CatalogSelectionProvider><CatalogFilters initial={initial} auctionResults facets={{makes:[],models:[],bodyTypes:[],transmissions:[],fuels:['petrol'],drives:[]}} resultCount={24}/></CatalogSelectionProvider>;
}

if(typeof window!=='undefined'){
 const fixture={calls:[] as string[],errors:[] as string[],ready:false,acknowledge:()=>{},navigate(href:string){
  fixture.calls.push(href);history.pushState(null,'',href);queueMicrotask(()=>fixture.acknowledge());
 }};
 (window as any).__japanCityFixture=fixture;
 hydrateRoot(document.getElementById('root')!,<JapanCityFixture initial={(window as any).__japanCityInitial}/>,{onRecoverableError:error=>fixture.errors.push(String(error))});
}
