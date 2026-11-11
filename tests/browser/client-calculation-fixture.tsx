import React from 'react';
import {createRoot} from 'react-dom/client';
import {InlineOfferParameters} from '../../apps/web/components/catalog/InlineOfferParameters';
import {ShareLinkButton} from '../../apps/web/components/catalog/ShareLinkButton';
const mode=new URLSearchParams(location.search).get('mode');
const draft={year:'2021',productionMonth:'11',fuel:'petrol',engineCc:'1498',powerHp:'120',deliveryCity:''};
const calculation={totalRub:2000000,breakdown:[],currencyRate:{currency:'CNY',sourcePrice:100000,effectiveRate:12.5}};
createRoot(document.getElementById('root')!).render(<main data-offer-id="qa" data-offer-saved-version={mode==='shared'?'client-version':undefined}>
<InlineOfferParameters canSave={mode==='admin'} offerId="qa" initial={draft} savedCalculation={{version:'base-version',draft,calculation} as any} initialScenario={mode==='shared'?{draft:{...draft,deliveryCity:'Новокузнецк'},calculation} as any:null} deliveryMarket="china" price={<p>Цена</p>}><ShareLinkButton/></InlineOfferParameters>
</main>);
