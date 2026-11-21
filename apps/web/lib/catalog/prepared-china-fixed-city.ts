import {createHash} from 'node:crypto';
import {quoteCityDelivery} from './city-delivery';
import {deliveryPricingBasis,priceCardForCity} from './card-city-delivery';
import {catalogMakeFilterValues,catalogSearchProjectionMatches,projectionCanRenderCard,type CatalogSearchProjection} from './storage';
import {createPreparedChinaModelView,type PreparedChinaModelPosition,type PreparedChinaModelViewRef} from './prepared-china-model-view';
import {businessPaymentPlan} from '../../../../packages/engine/src/calculation/calculateAvtocena';
import type {BusinessCalculationLine,MarketBusinessConfig} from '../../../../packages/engine/src/types';
import type {CatalogSearchParams,VehicleOffer} from './types';

const scopes=[
 {id:'novokuznetsk-v1',city:'Новокузнецк',make:undefined,yearFrom:2022,yearTo:undefined,low:1_500_000,high:2_500_000},
 {id:'kemerovo-v1',city:'Кемерово',make:'Mercedes-Benz,BMW',yearFrom:2019,yearTo:2023,low:0,high:2_550_000},
] as const;
export type ChinaFixedCityScope=(typeof scopes)[number];
export type ChinaFixedCityRefs=Partial<Record<ChinaFixedCityScope['id'],PreparedChinaModelViewRef>>;
const SHA=/^[a-f0-9]{64}$/;
const fail=(why:string):never=>{throw Error('prepared_china_city:'+why);};
const makeKeys=(v:unknown)=>[...new Set(catalogMakeFilterValues(v).map(x=>x.toLocaleLowerCase('ru-RU')))].sort();
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

export function preparedChinaDeliveryQuote(city:string){
 const q=quoteCityDelivery(city,'china');
 const exactOriginPickup=q.city===q.origin&&q.distanceKm===0&&q.amountRub===0;
 if(q.status!=='estimated'||q.origin!=='Уссурийск'||!Number.isSafeInteger(q.amountRub)||
  !(q.amountRub>0||exactOriginPickup))return fail('quote_unavailable');
 return q;
}
export function fixedChinaCityQuote(scope:ChinaFixedCityScope){
 const q=preparedChinaDeliveryQuote(scope.city);
 if(q.city!==scope.city)return fail('quote_scope');
 return q;
}
export const fixedChinaCityKey=(scope:ChinaFixedCityScope)=>createHash('sha256').update(JSON.stringify([
 'china-fixed-city-price-asc-v1',scope.id,makeKeys(scope.make),scope.yearFrom,scope.yearTo,scope.low,scope.high,fixedChinaCityQuote(scope)
])).digest('hex');
export function fixedChinaCityForName(city:string){
 const quote=quoteCityDelivery(city,'china');
 return quote.status==='estimated'?scopes.find(s=>s.city===quote.city)??null:null;
}
export function eligibleChinaFixedCityQuery(params:CatalogSearchParams){
 if(params.market!=='china'||params.sort!=='totalRub'||!params.city||
    Object.entries(params).some(([k,v])=>v!==undefined&&!['market','city','make','yearFrom','yearTo','budgetFrom','budgetTo','sort','page','pageSize'].includes(k)))return null;
 const scope=fixedChinaCityForName(params.city);
 if(!scope||!equal(makeKeys(params.make),makeKeys(scope.make))||scope.yearFrom!==params.yearFrom||scope.yearTo!==params.yearTo||
    (params.budgetFrom??0)<scope.low||!Number.isFinite(params.budgetFrom??0)||params.budgetTo===undefined||
    !Number.isFinite(params.budgetTo)||params.budgetTo>scope.high||params.budgetTo<0)return null;
 return scope;
}
export function fixedChinaCityMembership(row:CatalogSearchProjection,scope:ChinaFixedCityScope){
 return projectionCanRenderCard(row)&&catalogSearchProjectionMatches(row,{market:'china',make:scope.make,yearFrom:scope.yearFrom,yearTo:scope.yearTo});
}

/** Pure existing city delta; no engine, external tariff, inventory or supplier read. */
export function projectFixedChinaCity(row:CatalogSearchProjection,scope:ChinaFixedCityScope){
 return projectPreparedChinaDelivery(row,scope.city);
}
export function projectPreparedChinaDelivery(row:CatalogSearchProjection,city:string){
 const quote=preparedChinaDeliveryQuote(city),basis=deliveryPricingBasis(row.calculationSnapshot);
 if(row.market!=='china'||row.catalogPricingMode==='seller'||!Number.isSafeInteger(row.totalRub)||!(row.totalRub!>0)||
    !basis||!Number.isSafeInteger(basis.subtotalRub)||basis.subtotalRub<=0||!Number.isSafeInteger(basis.deliveryRub)||basis.deliveryRub<0||
    !Array.isArray(basis.percents)||basis.percents.length>100||basis.percents.some(p=>!Number.isFinite(p)||p<0))return fail('delivery_basis');
 const derived=priceCardForCity(row,quote.city).offer as CatalogSearchProjection;
 const rub=derived.totalRub;
 if(!Number.isSafeInteger(rub)||!(rub!>0))return fail('city_total');
 // An already city-adjusted list DTO must not apply the fee again when legacy
 // card presentation calls priceCardForCity for this same city.
 return {...derived,totalRub:rub,publicVisibleRub:rub!,previousTotalRub:null,priceDeltaRub:null,
  calculationSnapshot:{...derived.calculationSnapshot,deliveryPricingBasis:{...basis,
   subtotalRub:basis.subtotalRub+quote.amountRub-basis.deliveryRub,deliveryRub:quote.amountRub}}};
}

/** Reapply the *same* already quoted domestic delivery to full local
 * ledger lines, preserving bank/FX/car/customs. Refuse ambiguous configurations. */
export function applyFixedChinaCityLedger(offer:VehicleOffer,projection:CatalogSearchProjection,scope:ChinaFixedCityScope){
 return applyPreparedChinaDeliveryLedger(offer,projection,scope.city);
}
export function applyPreparedChinaDeliveryLedger(offer:VehicleOffer,projection:CatalogSearchProjection,destination:string){
 const snapshot=offer.calculationSnapshot,base=deliveryPricingBasis(snapshot);
 const city=projectPreparedChinaDelivery(projection,destination),quote=preparedChinaDeliveryQuote(destination),target=city.totalRub!;
 const lines=snapshot?.breakdown as BusinessCalculationLine[]|undefined,config=snapshot?.marketConfig as MarketBusinessConfig|undefined;
 if(!snapshot||!Array.isArray(lines)||!config||!base||
    !equal(base,deliveryPricingBasis(projection.calculationSnapshot))||offer.totalRub!==projection.totalRub||
    lines.reduce((sum,line)=>sum+line.amountRub,0)!==offer.totalRub)return fail('ledger_basis');
 const byId=new Map(lines.map(line=>[line.id,line]));
 if(byId.size!==lines.length||(byId.get('rf-delivery')?.amountRub??0)!==base.deliveryRub)return fail('ledger_delivery');
 const percent=config.percentExpenses||[];
 const reserved=new Set(['car','contract-services','topavto-commission','logistics','broker','svh','laboratory',
  'rf-delivery','customs','utilization-fee','other-fixed','bank-transfer','exchange-reserve']);
 if(new Set(percent.map(p=>p.id)).size!==percent.length||percent.some(p=>reserved.has(p.id)))return fail('ledger_percent');
 const subtotal=base.subtotalRub+quote.amountRub-base.deliveryRub;
 const pct=percent.map(p=>{
  const ratio=Number(p.percent);
  const old=byId.get(p.id);
  if(!Number.isFinite(ratio)||ratio<0||((old?.amountRub??0)!==Math.round(base.subtotalRub*ratio/100))||
     (old&&old.amountType!=='percent'))return fail('ledger_percent');
  return {id:p.id,title:p.title,kind:'other' as const,amountType:'percent' as const,source:'market_config' as const,
   note:`${p.percent}%`,amountRub:Math.round(subtotal*ratio/100)};
 }).filter(line=>line.amountRub>0);
 const pctKeys=new Set(percent.map(line=>line.id));
 if(lines.some(line=>line.amountType==='percent'&&!pctKeys.has(line.id)&&!['bank-transfer','exchange-reserve'].includes(line.id)))return fail('ledger_percent_scope');
 const fixed=lines.filter(line=>line.id!=='rf-delivery'&&!pctKeys.has(line.id)&&!['bank-transfer','exchange-reserve'].includes(line.id));
 const beforeCustoms=fixed.findIndex(line=>line.id==='customs'||line.id==='utilization-fee'||line.id==='other-fixed');
 fixed.splice(beforeCustoms<0?fixed.length:beforeCustoms,0,{id:'rf-delivery',title:`Доставка по РФ: ${quote.city}`,amountRub:quote.amountRub,
  kind:'logistics',amountType:'fixed',source:'manager'});
 const delivered=[...fixed,...pct,...lines.filter(line=>line.id==='bank-transfer'||line.id==='exchange-reserve')];
 if(delivered.reduce((sum,line)=>sum+line.amountRub,0)!==target)return fail('ledger_total');
 return {...offer,totalRub:target,previousTotalRub:null,priceDeltaRub:null,deliveryCity:quote.city,
  calculationSnapshot:{...snapshot,breakdown:delivered,paymentPlan:businessPaymentPlan('china',config,target)}};
}

export function createChinaFixedCityViews(generationId:string){
 const writers=scopes.map(scope=>({scope,writer:createPreparedChinaModelView(generationId,fixedChinaCityKey(scope))}));
 return {
  add(row:CatalogSearchProjection,position:Omit<PreparedChinaModelPosition,'rub'>,verifyDetail?:(scope:ChinaFixedCityScope,rub:number)=>void){
   for(const {scope,writer} of writers){
    if(!fixedChinaCityMembership(row,scope))continue;
    const rub=projectFixedChinaCity(row,scope).totalRub!;
    if(rub>=scope.low&&rub<=scope.high){verifyDetail?.(scope,rub);writer.add({...position,rub});}
   }
  },
  async publish(put:(path:string,body:Buffer)=>Promise<void>){
   const out:ChinaFixedCityRefs={};
   for(const {scope,writer} of writers)out[scope.id]=await writer.publish(put);
   return out;
  },
 };
}
export function fixedChinaCityViewRef(refs:ChinaFixedCityRefs|undefined,scope:ChinaFixedCityScope){
 if(refs===undefined)return null;
 const ref=refs[scope.id];
 if(!ref||!SHA.test(ref.keySha256)||!SHA.test(ref.viewSha256)||ref.keySha256!==fixedChinaCityKey(scope))return fail('tariff_or_scope_changed');
 return ref;
}
