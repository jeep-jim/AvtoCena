// Isolated responsive fixture: real editors and power labels, no production data or network writes.
import React from "react";
import { createRoot } from "react-dom/client";
import { InlineOfferParameters } from "../../apps/web/components/catalog/InlineOfferParameters";
import { RecyclingPowerLabel, RecyclingFeeHelp } from "../../apps/web/components/catalog/RecyclingPower";
import { recyclingPowerInfo } from "../../apps/web/lib/catalog/recycling-power";
import styles from "../../apps/web/components/catalog/RecyclingPower.module.css";
const data={fuel:"petrol",powertrainKind:"combustion",vehicleCategory:"M1",powerHp:160,powerKw:118};
const info=recyclingPowerInfo(data);
const initial={year:"2026",engineCc:"1498",fuel:"petrol",powerHp:"160",powerKw:"118",vehicleCategory:"M1",productionMonth:"",productionDay:"",hybridKind:"combustion",power30MinKw:"",icePowerKw:""};
function App(){return <main className="ac-offer-page ac-page-copy" style={{padding:16,minHeight:"100vh"}}>
<h1 style={{fontSize:20,marginBottom:16}}>АвтоЦена · проверка встроенных обозначений</h1>
<div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:10,maxWidth:620,marginBottom:24}}>
{[0,1].map(i=><article key={i} className="ac-catalog-card" style={{minWidth:0,borderRadius:20,background:"var(--ac-surface-2)"}}><div style={{height:100,padding:10}}>Volkswagen T-Roc</div><div className="p-2.5 sm:p-3.5">
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}><strong>4 333 490 ₽</strong><span data-price-arrow>↘</span></div>
<div className={`${styles.wrapChips} flex flex-nowrap overflow-x-auto whitespace-nowrap font-bold mt-2 gap-1 text-[8px] sm:mt-3 sm:gap-2 sm:text-[11px]`}>
<span className="flex shrink-0 items-center gap-1 rounded-full px-1.5 py-1 sm:px-2.5 sm:py-1.5">1 498 см³</span>
<span data-recycling-power-chip className={`${styles.warningChip} flex shrink-0 items-center gap-1 rounded-full px-1.5 py-1 sm:gap-1.5 sm:px-2.5 sm:py-1.5`}><span aria-hidden>ϟ</span><RecyclingPowerLabel hpLabel="160 л.с." info={info} showKw/></span>
</div></div></article>)}
</div>
<section style={{width:"100%",maxWidth:390}}><h2 style={{fontSize:20,marginBottom:12}}>Volkswagen T-Roc</h2>
<InlineOfferParameters offerId="qa-118" initial={initial} price={<div className="ac-offer-price-panel" style={{padding:16,borderRadius:20,background:"var(--ac-surface-2)"}}>Ориентир стоимости<br/><strong style={{fontSize:28}}>4 333 490 ₽</strong></div>}><details className="ac-original-calculation" style={{marginTop:16}}><summary>Структура цены</summary><div>Утилизационный сбор · 900 000 ₽<RecyclingFeeHelp info={info}/></div></details></InlineOfferParameters>
</section></main>}
createRoot(document.getElementById("root")!).render(<App/>);
