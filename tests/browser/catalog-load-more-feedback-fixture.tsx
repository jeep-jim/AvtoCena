import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CatalogFilters} from '../../apps/web/components/catalog/CatalogFilters';
import {CatalogSidebar} from '../../apps/web/components/catalog/CatalogSidebar';
import {CatalogLoadMore} from '../../apps/web/components/catalog/CatalogLoadMore';
import {RoutePreloader} from '../../apps/web/components/layout/RoutePreloader';
function App(){
 const [initial,setInitial]=useState<Record<string,string>>({});
 return <><RoutePreloader/><main style={{maxWidth:1200,margin:'auto',padding:16}}>
  <button id="ack" onClick={()=>setInitial(Object.fromEntries(new URLSearchParams(location.search)))}>Ответ готов</button>
  <CatalogSidebar filters={<CatalogFilters initial={initial} facets={{makes:['Audi'],models:[],markets:[],bodyTypes:[],fuels:['diesel','electric'],drives:[],transmissions:[]}}/>}>
   <CatalogLoadMore query={{market:'korea'}} initialPage={8} initialTotal={14520} initialCount={24} initialCards={Array.from({length:6},(_,i)=><div key={i} style={{height:100}}>Автомобиль {i+1}</div>)}/>
  </CatalogSidebar>
 </main></>;
}
createRoot(document.getElementById('root')!).render(<App/>);
