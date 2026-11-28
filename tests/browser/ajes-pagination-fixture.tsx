import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CatalogLoadMore} from '../../apps/web/components/catalog/CatalogLoadMore';
import {CatalogCard} from '../../apps/web/components/catalog/CatalogCard';
import {CatalogSelectionProvider,CatalogResultCountUpdate} from '../../apps/web/components/catalog/CatalogSelectionContext';
const params=new URLSearchParams(location.search),market=params.get('market')||'china';
function LateCount(){
 const [ready,setReady]=useState(false),[make,setMake]=useState('');
 const original={market,city:'Новокузнецк'},query={...original,...(make?{make}: {})};
 const total=market==='korea'?89027:615568;
 return <CatalogSelectionProvider>
  <button onClick={()=>setReady(true)}>Получить количество</button>
  <button onClick={()=>setMake('Toyota')}>Другой фильтр</button>
  {ready&&<CatalogResultCountUpdate queryKey={JSON.stringify(original)} text={String(total)} total={total}/>}
  <CatalogLoadMore key={JSON.stringify(query)} resultQueryKey={JSON.stringify(query)} query={query} initialPage={1} initialTotal={null} initialCount={24} initialCards={<div>Первые 24 автомобиля</div>} initialHasMore resultCountLabel="Количество уточняется"/>
 </CatalogSelectionProvider>;
}
const refill=(window as any).__japanRefillInitial;
function Refill(){
 const [current,setCurrent]=useState(refill);
 useEffect(()=>{
  (window as any).__japanRefillReplace=(result:any)=>setCurrent({items:result.items,props:{...refill.props,
   initialPage:result.page,initialTotal:result.total,initialCount:result.items.length,initialHasMore:result.hasMore,initialNextCursor:result.nextCursor,
   initialPageKey:JSON.stringify([result.generationId,result.items.map((offer:any)=>offer.id),result.nextCursor]),
   initialIncomplete:Boolean(result.partial||result.stale||result.interrupted||result.scanLimited),
   sourceScopeComplete:result.sourceScopeComplete,
  }});
  return()=>{delete (window as any).__japanRefillReplace;};
 },[]);
 return <CatalogSelectionProvider><CatalogLoadMore key={JSON.stringify(current.props.query)} {...current.props} initialCards={current.items.map((offer:any)=><CatalogCard key={offer.id} offer={offer} compact dense/>)}/></CatalogSelectionProvider>;
}
createRoot(document.getElementById('root')!).render(refill?<Refill/>:params.has('late')?<LateCount/>:<CatalogLoadMore query={{market,make:'Volkswagen',bodyType:'suv'}} initialPage={1} initialTotal={market==='china'?null:345} initialCount={24} initialCards={<div>Первые 24 автомобиля</div>} initialHasMore initialNextCursor={market==='china'?'6.20':undefined}/>);
