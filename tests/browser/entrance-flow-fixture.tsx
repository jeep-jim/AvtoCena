import React from 'react';
import {createRoot} from 'react-dom/client';
import {AutoCalcButton} from '../../apps/web/components/autocalc/AutoCalcButton';
import {AutoCalcPage} from '../../apps/web/components/autocalc/AutoCalcPage';
import {CalculationMarketFields} from '../../apps/web/components/crm/settings/CalculationMarketFields';
import {OfferMobileActions,OfferContactActionsStyles} from '../../apps/web/components/catalog/OfferContactActions';
const markets=[{id:'korea',name:'Корея',currency:'KRW'},{id:'japan',name:'Япония',currency:'JPY'},{id:'china',name:'Китай',currency:'CNY'}];
if(location.pathname==='/controls')createRoot(document.getElementById('root')!).render(<>
  <header className="ac-public-header" style={{position:'fixed',inset:'0 0 auto',height:64,background:'#fff',zIndex:50}}>Шапка</header>
  <main className="ac-offer-page" style={{paddingTop:80}}>
    <AutoCalcButton/>
    <form action="/controls" method="get"><CalculationMarketFields key={location.search} marketId={new URLSearchParams(location.search).get('calcMarket')||'korea'} sourcePrice={1000000} markets={markets} inputClass=""/><input name="calcPowerHp" defaultValue="150"/><button>Пересчитать</button></form>
    <div style={{height:700}}/>
    <OfferMobileActions offerId="fixture" snapshot={{id:'fixture',title:'Toyota'}}/>
    <div style={{height:1800}}/>
  </main><OfferContactActionsStyles/>
</>);
else if(location.pathname==='/autocalc')createRoot(document.getElementById('root')!).render(<AutoCalcPage initialUrl=""/>);
else void import('./account-entrance-fixture');
