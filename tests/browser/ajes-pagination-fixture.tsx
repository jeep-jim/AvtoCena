import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CatalogLoadMore} from '../../apps/web/components/catalog/CatalogLoadMore';
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
createRoot(document.getElementById('root')!).render(params.has('late')?<LateCount/>:<CatalogLoadMore query={{market,make:'Volkswagen',bodyType:'suv'}} initialPage={1} initialTotal={market==='china'?null:345} initialCount={24} initialCards={<div>Первые 24 автомобиля</div>} initialHasMore initialNextCursor={market==='china'?'6.20':undefined}/>);
