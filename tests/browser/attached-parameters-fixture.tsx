// Actual editor component; all calculation requests are intercepted by the browser test.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { InlineOfferParameters } from '../../apps/web/components/catalog/InlineOfferParameters';
const kind = new URLSearchParams(location.search).get('kind') || 'petrol';
const isHybrid=kind==='hybrid'||kind==='missing-hybrid';
const initial = {year:'2026',engineCc:'1498',fuel:isHybrid?'hybrid':'petrol',powerHp:kind==='missing-hybrid'?'':'160',powerKw:isHybrid?'':'118',vehicleCategory:kind==='n1'?'N1':'M1',productionMonth:'',productionDay:'',hybridKind:isHybrid?'other_hybrid':'combustion',power30MinKw:isHybrid?'50':'',icePowerKw:isHybrid?'100':'',grossVehicleWeightKg:kind==='n1'?'2800':''};
function App(){return <main className="ac-offer-page ac-page-copy" style={{padding:16,minHeight:'100vh'}}>
 <div style={{maxWidth:390,margin:'40px auto 0'}}>
  <InlineOfferParameters sourcePriceOnly={kind==='missing-hybrid'} autoCalculate={kind==='missing-hybrid'} offerId="qa-attached" initial={initial} showCommercial={kind==='n1'} isPickup={kind==='n1'} price={<div className="ac-offer-price-panel" style={{padding:16,borderRadius:20,background:'var(--ac-surface-2)'}}><span>{kind==='missing-hybrid'?'Цена продавца':'Проверка интерфейса'}</span><br/><strong style={{fontSize:28}}>4 333 490 ₽</strong></div>}>
   <div data-following-content style={{marginTop:16}}><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}><div className="ac-offer-spec-tile" style={{padding:16,borderRadius:16}}>Робот</div><div className="ac-offer-spec-tile" style={{padding:16,borderRadius:16}}>Кроссовер</div></div>
   <button style={{width:'100%',padding:16,marginTop:12,borderRadius:16,background:'var(--ac-surface-2)'}}>Уточнить характеристики с ИИ</button>
   <div className="ac-original-calculation" style={{padding:20,marginTop:16,borderRadius:20,background:'var(--ac-surface-2)'}}>Структура цены</div>
   <div style={{padding:20,marginTop:16,borderRadius:20,background:'var(--ac-surface-2)'}}>Обновлено · тестовый стенд</div>
   <button data-outside style={{width:'100%',padding:16,marginTop:16}}>Вне выпадающего меню</button></div>
  </InlineOfferParameters>
 </div></main>}
createRoot(document.getElementById('root')!).render(<App/>);
