import {createHash} from 'node:crypto';
import {calculateRussiaCustomsForIndividual,type RussiaCustomsV2Input} from '../../../../packages/engine/src/calculation/russiaCustomsV2';
import {DELIVERY_TARIFF_VERSION,quoteCityDelivery} from './city-delivery';
import {deliveryPricingBasis} from './card-city-delivery';
import {projectPreparedChinaDelivery,applyPreparedChinaDeliveryLedger} from './prepared-china-fixed-city';
import {verifyPriceCardBlock,type PreparedPriceCardDescriptor} from './prepared-price-card-block';
import type {CatalogFxBatch} from './rates';
import type {CatalogSearchProjection} from './storage';
import type {VehicleOffer} from './types';
const fail=(c:string):never=>{throw Error('china_fresh_golden:'+c);};
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const cities=['Владивосток','Новокузнецк','Новосибирск'] as const;
/** Independently re-execute the unchanged customs engine on exact authored inputs
 * and check served list and detail against an independent city-delta arithmetic.
 * Intended for a reviewed stratified sample, never per HTTP request. */
export function compareFreshChinaGolden({descriptor,bytes,projections,fx,ids}:{
 descriptor:PreparedPriceCardDescriptor;bytes:Buffer;projections:readonly CatalogSearchProjection[];
 fx:CatalogFxBatch;ids:readonly string[];
}){
 if(descriptor.market!=='china'||fx.receipt.market!=='china'||descriptor.fxReceiptSha256!==fx.receiptSha256||
  descriptor.pricingAsOf!==fx.receipt.pricingAsOf||!ids.length||ids.length>16||new Set(ids).size!==ids.length||
  projections.length!==descriptor.rows)return fail('scope');
 const b=verifyPriceCardBlock(bytes,descriptor),evidence=[];
 for(const id of ids){
  const d=b.details.find(x=>x.id===id),row=projections.find(x=>x.id===id);
  if(!d||!row||row.market!=='china'||row.totalRub!==d.totalRub)return fail('identity');
  const l=d.ledger as any;
  const raw=l.customsInput as RussiaCustomsV2Input;
  if(!raw||new Date(raw.importedAt).toISOString()!==fx.receipt.pricingAsOf||raw.eurRateRub!==fx.receipt.rates.EUR?.effectiveRate||
    l.currencyRate?.effectiveRate!==fx.receipt.rates.CNY?.effectiveRate||
    l.currencyRate?.currency!=='CNY')return fail('authored_inputs');
  const independently=calculateRussiaCustomsForIndividual({...raw,importedAt:new Date(raw.importedAt)});
  const fields=['status','vehicleCategory','legalRuleRevision','knownCustomsRub','utilizationFeeRub','totalCustomsRub','utilizationPowerKw'] as const;
  if(independently.status!=='ready'||fields.some(k=>independently[k]!==l.customs[k]))return fail('customs_engine');
  const basis=deliveryPricingBasis(l);
  if(!basis||basis.subtotalRub<=0||!basis.percents.every(Number.isFinite))return fail('delivery_basis');
  const totals=cities.map(city=>{
   const quote=quoteCityDelivery(city,'china');
   if(quote.origin!=='Уссурийск'||quote.status!=='estimated'||quote.version!==DELIVERY_TARIFF_VERSION)return fail('city_quote');
   const delta=quote.amountRub-basis.deliveryRub;
   const total=d.totalRub+delta+basis.percents.reduce((p,c)=>p+Math.round((basis.subtotalRub+delta)*c/100)-Math.round(basis.subtotalRub*c/100),0);
   const list=projectPreparedChinaDelivery(row,city);
   const detail=applyPreparedChinaDeliveryLedger({...row,totalRub:d.totalRub,calculationSnapshot:l} as VehicleOffer,row,city);
   if(list.totalRub!==total||detail.totalRub!==total)return fail('list_detail_total');
   return {city,deliveryRub:quote.amountRub,totalRub:total};
  });
  evidence.push({id,ledgerSha256:hash(l),customsSha256:hash(fields.map(k=>independently[k])),totals});
 }
 const proof={version:1,kind:'china-actual-golden-sample-only',fxReceiptSha256:fx.receiptSha256,priceBlockSha256:descriptor.contentSha256,
  deliveryTariffVersion:DELIVERY_TARIFF_VERSION,checked:evidence.length,sampleSha256:hash(evidence)};
 return Object.freeze({proof,proofSha256:hash(proof)});
}
