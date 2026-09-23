import {OfferUpdatedStatus} from "../../apps/web/components/catalog/OfferUpdatedStatus";
// Actual editor component; all calculation requests are intercepted by the browser test.
import React from 'react';
import {OfferMobileActions, OfferDesktopActions, OfferContactActionsStyles} from '../../apps/web/components/catalog/OfferContactActions';
import {SellerPrice} from '../../apps/web/components/catalog/SellerPrice';
import {PublicHeader} from '../../apps/web/components/layout/PublicHeader';
import {OfferSpecificationsDisclosure} from '../../apps/web/components/catalog/OfferSpecificationsDisclosure';
import {CrmLiveAlerts} from '../../apps/web/components/crm/CrmLiveAlerts';
import { createRoot } from 'react-dom/client';
import { InlineOfferParameters } from '../../apps/web/components/catalog/InlineOfferParameters';
const kind = new URLSearchParams(location.search).get('kind') || 'petrol';
const isElectric=kind==='electric';
const isHybrid=kind==='hybrid'||kind==='missing-hybrid';
const initial = {year:'2026',engineCc:'1498',fuel:isElectric?'electric':isHybrid?'hybrid':'petrol',powerHp:kind==='missing-hybrid'?'':'160',powerKw:isHybrid?'':'118',vehicleCategory:kind==='n1'?'N1':'M1',productionMonth:'',productionDay:'',hybridKind:isHybrid?'other_hybrid':'combustion',power30MinKw:isHybrid?'50':'',icePowerKw:isHybrid?'100':'',grossVehicleWeightKg:kind==='n1'?'2800':''};
const savedCalculation=kind.startsWith('saved-')?{version:'v1',savedAt:'2026-09-20T10:00:00Z',savedByName:'Предыдущий сотрудник',draft:{...initial,deliveryCity:'Новокузнецк'},calculation:{totalRub:2500000,paymentPlan:{securityDepositRub:31000},breakdown:[{id:'car',amountRub:2000000},{id:'commission',amountRub:39000}]}}:null;
function App(){if(kind==='offer-actions')return <main className="ac-offer-page" style={{padding:16}}><div className="ac-offer-layout grid min-w-0 gap-3 xl:gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(390px,.75fr)]">
 <div data-test-media><div data-test-photo style={{height:120,background:'#8796a4',borderRadius:20}}>Фото</div><OfferSpecificationsDisclosure mode="desktop" title="Nissan LEAF" groups={[{name:'Об автомобиле',items:[{name:'Марка',value:'Nissan'},{name:'Модель',value:'LEAF'}]}]} headerAside={<OfferUpdatedStatus date="17.09.2026" time="09:41" sourceUrl="https://example.com/offer"/>}/><OfferDesktopActions offerId="qa-layout" snapshot={{id:"qa-layout"}} position="below"/></div>
 <div data-test-sidebar><InlineOfferParameters offerId="qa-layout" initial={initial} price={<div data-test-price className="ac-offer-price-panel" style={{height:80}}>3 266 183 ₽</div>} afterPrice={<OfferMobileActions offerId="qa-layout" snapshot={{id:"qa-layout"}}/>}><OfferDesktopActions offerId="qa-layout" snapshot={{id:"qa-layout"}}/></InlineOfferParameters></div></div><OfferContactActionsStyles/></main>;if(kind.startsWith('alerts'))return <PublicHeader backHref="/cars"/>;
 if(kind==='japan-specs')return <main className="ac-offer-page ac-page-copy" style={{width:900,margin:20}}><OfferSpecificationsDisclosure mode="desktop" title="Nissan Cube" groups={[{name:'Об автомобиле',items:[{name:'Марка',value:'Nissan'},{name:'Модель',value:'Cube'}]}]} headerAside={<div data-japan-auction-status className="flex items-center justify-between gap-3 rounded-2xl bg-[var(--ac-surface-2)] px-4"><p>Продано на торгах · ARAI Bayside · 18.09.2026</p><span>Оценка R</span></div>}/></main>;return <main className="ac-offer-page ac-page-copy" style={{padding:16,minHeight:'180vh'}}>
 <div style={{maxWidth:390,margin:'40px auto 0'}}>
  <InlineOfferParameters canSave={kind==='saved-admin'||kind==='unsaved-admin'} savedCalculation={savedCalculation as any} sourcePriceOnly={kind==='missing-hybrid'||isElectric} autoCalculate={kind==='missing-hybrid'||isElectric} offerId="qa-attached" initial={initial} showCommercial={kind==='n1'} isPickup={kind==='n1'} researchContext={isElectric?'Nissan Sakura X B6AW':''} price={kind==='missing-hybrid'||isElectric?<SellerPrice offer={{market:'korea',sellerPriceRub:4333490,fuel:initial.fuel}}/>:<div className="ac-offer-price-panel" style={{padding:16,borderRadius:20,background:'var(--ac-surface-2)'}}><span>{kind==='missing-hybrid'?'Цена продавца':'Проверка интерфейса'}</span><br/><strong style={{fontSize:28}}>4 333 490 ₽</strong></div>}>
   <div data-following-content style={{marginTop:16}}><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}><div className="ac-offer-spec-tile" style={{padding:16,borderRadius:16}}>Робот</div><div className="ac-offer-spec-tile" style={{padding:16,borderRadius:16}}>Кроссовер</div></div>
   <button style={{width:'100%',padding:16,marginTop:12,borderRadius:16,background:'var(--ac-surface-2)'}}>Уточнить характеристики с ИИ</button>
   <div className="ac-original-calculation" style={{padding:20,marginTop:16,borderRadius:20,background:'var(--ac-surface-2)'}}>Структура цены</div>
   <div style={{padding:20,marginTop:16,borderRadius:20,background:'var(--ac-surface-2)'}}>Обновлено · тестовый стенд</div>
   <button data-outside style={{width:'100%',padding:16,marginTop:16}}>Вне выпадающего меню</button></div>
  </InlineOfferParameters>
 </div></main>}
createRoot(document.getElementById('root')!).render(<App/>);
