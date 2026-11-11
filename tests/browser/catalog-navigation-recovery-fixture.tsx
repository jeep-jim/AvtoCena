import React,{Suspense,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DealerLink} from '../../apps/web/components/dealers/DealerBrowsingContext';
import {CatalogLoadMore} from '../../apps/web/components/catalog/CatalogLoadMore';
import {RoutePreloader} from '../../apps/web/components/layout/RoutePreloader';
let ready=false,resolve:()=>void;const response=new Promise<void>(r=>resolve=r);
function Destination(){if(!ready)throw response;return <h1>Корея Rexton</h1>;}
function App(){
 const [route,setRoute]=useState('');
 useEffect(()=>{(window as any).__fixtureNavigate=(url:string)=>{((window as any).__pushes||=[]).push(url);setRoute(url);};},[]);
 return <><RoutePreloader/><button id="resolve" onClick={()=>{ready=true;resolve();}}>Ответ готов</button><Suspense fallback={<p>Загрузка</p>}>{route?<Destination/>:<main>
  <DealerLink href="/cars?market=korea&make=SsangYong&model=Rexton&city=Новокузнецк" className="ac-market-all-link">Все из Кореи</DealerLink>
  <CatalogLoadMore query={{market:'japan',drive:'awd',city:'Новокузнецк'}} initialPage={1} initialCount={24} initialTotal={null} initialHasMore={false} initialNextCursor={null} initialIncomplete resultCountLabel="Количество уточняется" initialCards={Array.from({length:24},(_,i)=><article key={i}>Сохранённый {i}</article>)}/>
 </main>}</Suspense></>;
}
createRoot(document.getElementById('root')!).render(<App/>);
