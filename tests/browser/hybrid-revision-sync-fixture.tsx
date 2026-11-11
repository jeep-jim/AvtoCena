import React,{useCallback,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {InlineOfferParameters} from '../../apps/web/components/catalog/InlineOfferParameters';
const initial={year:'2026',fuel:'hybrid',engineCc:'1497',powerHp:'98',hybridKind:'series_hybrid',icePowerKw:'72',power30MinKw:'45',deliveryCity:''};
const calculation={totalRub:2000000,breakdown:[]};
function Fixture(){
 const [draft,setDraft]=useState(initial);
 const refresh=useCallback(()=>{(window as any).refreshes=((window as any).refreshes||0)+1;setDraft({...initial,power30MinKw:String((window as any).nextPower)});},[]);
 return <main data-offer-id="hybrid"><InlineOfferParameters onKnowledgeRefresh={refresh} canSave offerId="hybrid" initial={initial} savedCalculation={{version:'same-saved-version',draft,calculation} as any} initialScenario={location.search.includes('archive')?{draft:initial,calculation} as any:null} deliveryMarket="china" price={<p>Цена</p>}><span/></InlineOfferParameters></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
