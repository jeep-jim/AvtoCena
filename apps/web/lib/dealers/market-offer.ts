import type {SpecialCalculationOffer,SpecialOffer} from './showcase-model';
import type {BusinessCalculationInput} from '../../../../packages/engine/src/types';
import {calculateAvtocenaFromBusinessConfig} from '../../../../packages/engine/src/calculation/calculateAvtocena';
import {quoteCityDelivery} from '../catalog/city-delivery';
export const MARKET_CURRENCIES: Record<string,string> = {japan:'JPY',china:'CNY',korea:'KRW',uae:'AED',europe:'EUR',georgia:'USD'};
export type MarketQuote={key:string;at:string;rate:number;input?:BusinessCalculationInput;error?:string};
export function marketOfferKey(o:SpecialCalculationOffer){return JSON.stringify([o.market,o.currency,o.invoice,o.purchaseTotal,o.year,o.productionMonth,o.engineCc,o.powerHp,o.power30MinKw,o.fuel]);}
export function marketRequest(o:SpecialOffer,city:string){
 return {market:o.market,currency:o.currency,price:o.purchaseTotal,title:[o.make,o.model].filter(Boolean).join(' '),city:city||'Новосибирск',draft:{vehicleCategory:'M1',year:o.year,productionMonth:o.productionMonth,engineCc:o.engineCc,powerHp:o.powerHp,fuel:o.fuel==='series_hybrid'?'hybrid':o.fuel,hybridKind:o.fuel==='series_hybrid'?'series_hybrid':'other_hybrid',power30MinKw:o.power30MinKw,icePowerKw:o.powerHp*0.73549875}};
}
export function calculateMarketOffer(o:SpecialCalculationOffer,city:string,now=new Date()){
 const q=o.marketQuote, delivery=quoteCityDelivery(city,o.market,o.deliveryOriginCity);
 const errors:string[]=[];
 if(!o.market||!o.currency)errors.push('Выберите рынок и валюту');
 if(!(Number(o.invoice)>0)||!(Number(o.purchaseTotal)>=Number(o.invoice)))errors.push('Сумма с расходами должна быть не меньше положительного инвойса');
 if(!q||q.key!==marketOfferKey(o)||now.getTime()-Date.parse(q.at)>86400000||!Number.isFinite(Date.parse(q.at)))errors.push('Обновите расчёт автомобиля');
 if(q?.error)errors.push(q.error);
 if(!q?.input&&!errors.length)errors.push('Расчёт пока недоступен');
 if(city&&delivery.status!=='estimated')errors.push('Уточните доставку в выбранный город');
 const result=!errors.length&&q?.input?calculateAvtocenaFromBusinessConfig({...q.input,cityDeliveryRub:delivery.amountRub,deliveryCity:delivery.city}):null;
 return {complete:!!result,errors,rate:q?.rate||0,city:delivery.city,daysFrom:undefined as number|undefined,daysTo:undefined as number|undefined,lines:result?.breakdown.map(l=>({...l,title:l.id==='car'?'Автомобиль и расходы в стране покупки':l.id==='rf-delivery'?`Доставка: ${delivery.origin} → ${delivery.city}`:l.title,id:l.id==='rf-delivery'?'delivery':l.id}))||[],totalRub:result?.totalRub??null};
}
export function orderedOffers<T extends {position?:number}>(offers:T[]):T[]{return [...offers].sort((a,b)=>(a.position||0)-(b.position||0));}
