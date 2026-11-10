import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import HomePageClient, {HomeCatalogPayload, type HomeCatalogData} from '../../apps/web/components/home/HomePageClient';
import styles from '../../apps/web/app/(public)/home.module.css';
const calls:string[]=[];
(window as any).homeCalls=calls;
window.fetch=async(input:any)=>{
 const url=String(input);calls.push(url);
 if(url.includes('/models?'))return new Promise(()=>{});
 return new Response(JSON.stringify({ok:true,total:42,items:[],rates:[],user:null}),{headers:{'content-type':'application/json'}});
};
const data:HomeCatalogData={initialOffers:[{id:'fixture:1',market:'china',make:'Toyota',model:'Corolla',year:2023,mileageKm:20000,sourcePrice:85000,sourceCurrency:'CNY',fuel:'petrol',drive:'fwd',transmission:'automatic',engineCc:1500,powerHp:121,totalRub:null,calculationStatus:'needs_data',catalogPricingMode:'seller',sellerPriceRub:1020000,calculationSnapshot:{currencyRate:{rateSource:'cbr',currency:'CNY',sourcePrice:85000,effectiveRate:12}},images:[{url:'/buyers/1.jpg'}],updatedAt:'2026-11-08T00:00:00Z'}],initialMarketCounts:{china:1},initialMarketCountInfo:{},initialCount:1,initialCountIncomplete:false,initialGreen:{items:[],total:0}};
function Fixture(){
 const [ready,setReady]=useState(false);
 return <><button id="release-cards" onClick={()=>setReady(true)}>Завершить загрузку карточек</button><div className={styles.scope}><HomePageClient initialCity="Новокузнецк" dealerGallery={[]} catalogSlot={ready?<HomeCatalogPayload data={data}/>:<div id="pending-cards">Ожидание карточек</div>}/></div></>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
