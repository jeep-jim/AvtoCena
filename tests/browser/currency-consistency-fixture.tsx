import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PriceTrend} from '../../apps/web/components/catalog/PriceTrend';
import {ConsentCheckbox} from '../../apps/web/components/legal/ConsentCheckbox';
function App(){const [checked,setChecked]=useState(false);return <main style={{maxWidth:760,margin:'auto',padding:20}}><ConsentCheckbox checked={checked} onChange={setChecked}/>{[404125,100000].map((sourcePrice,i)=><section key={i} data-car={i} style={{padding:20,marginTop:20}}><PriceTrend panel offer={{totalRub:8811105,sourceCurrency:'CNY',sourcePrice,priceDeltaRub:i?700:-703,calculationSnapshot:{currencyRate:{currency:'CNY',rateSource:'cbr_live',effectiveRate:12.5629,previousEffectiveRate:12.5355,rateDelta:.0274,rateDate:'2026-09-29',previousRateDate:'2026-09-26'}}}}/></section>)}</main>};createRoot(document.getElementById('root')!).render(<App/>);
