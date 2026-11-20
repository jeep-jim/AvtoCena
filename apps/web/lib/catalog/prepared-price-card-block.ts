import {createHash} from 'node:crypto';
import {readFreshChinaPreparedPrices,type FreshChinaPriceReplay} from './prepared-china-fresh-price-replay';
import type {JsonStorage} from '../data';
import {deliveryPricingBasis} from './card-city-delivery';
import {includedDepositCost} from './deposit-cost-projection';
import {buildBudgetCountIndex,matchingBudgetIndex,type BudgetCountIndex} from './budget-count-index';
import {applyActiveBusinessPriceBatch} from './live-business-pricing';
import {budgetPricingFingerprint,calculationCacheVersion} from './shared-budget-prices';
import {withCatalogFxBatch,type CatalogFxBatch} from './rates';
import {fxTariffHorizon,certifiedFxTariffHorizon} from './fx-tariff-horizon';
import {projectionCanRenderCard,searchProjectionFromOffer,type CatalogManifest} from './storage';
import {hasModificationSelection} from './modification-contract';
import type {CatalogMarket,CatalogSearchParams,VehicleOffer} from './types';

const markets=['china','korea','uae','europe','georgia'] as const;
type PreparedMarket=Extract<CatalogMarket,(typeof markets)[number]>;
const MAX_ROWS=128, MAX_BYTES=4*1024*1024;
const sha=/^[a-f0-9]{64}$/, generation=/^gen_\d+_[a-z0-9]+$/, chunk=/^chunk-\d{4,10}$/;
const hashBytes=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const jsonBytes=(value:unknown)=>Buffer.from(JSON.stringify(value));
export const preparedPriceCardDigest=(value:unknown)=>hashBytes(jsonBytes(value));
const fail=(reason:string):never=>{throw Error('prepared_price_card_block:'+reason);};
const policyDay=(ms:number)=>new Date(ms+7*3600000).toISOString().slice(0,10);

type Binding={
 version:1;generationId:string;market:PreparedMarket;marketInventoryDigest:string;sourceChunk:string;part:number;
 sourceInputSha256:string;sourceIdsSha256:string;calculationVersion:string;pricingFingerprint:string;fxReceiptSha256:string;
 pricingAsOf:string;policyDay:string;rows:number;freshSourceValidUntil?:number;
};
export type PreparedPriceCardDescriptor=Binding & {bytes:number;contentSha256:string;projectionSha256:string;tariffValidUntil:number;legalValidUntil?:number};
type Ledger=Record<string,unknown> & {breakdown:Array<{id:string;amountRub:number}>;customs:{status:string;utilizationPowerKw?:number}};
type Detail={id:string;totalRub:number;calculationStatus:VehicleOffer['calculationStatus'];ledger:Ledger};
type Block={binding:Binding;tariffValidUntil:number;legalValidUntil?:number;projectionSha256:string;index:BudgetCountIndex;details:Detail[]};
const ledgerKeys=[
 'breakdown','paymentPlan','marketConfig','configVersion','effectiveFrom','currencyRate','eurRate','sourcePriceRub',
 'customs','customsInput','customsValue','customsCompleteness','priceIncludesAllCustoms','priceIncludesUtilizationFee',
 'sourcePriceAdjustment','pricingConfidence','businessRepricedAt','businessConfigVersion','warnings',
] as const;

export function preparedPriceCardMarketDigest(manifest:CatalogManifest,market:PreparedMarket){
 if(manifest.version!==2||!manifest.markets?.[market]||!generation.test(manifest.generationId))return fail('manifest');
 return preparedPriceCardDigest([manifest.generationId,market,manifest.markets[market]]);
}
export function preparedPriceCardBlockPath(ref:PreparedPriceCardDescriptor){
 if(!markets.includes(ref.market)||!generation.test(ref.generationId)||!chunk.test(ref.sourceChunk)||
    !Number.isSafeInteger(ref.part)||ref.part<0||ref.part>1000||!sha.test(ref.contentSha256))return fail('path');
 return `catalog/generations/${ref.generationId}/indexes/prepared-price-cards-v1/${ref.market}/${ref.sourceChunk}/${ref.part}-${ref.contentSha256}.json`;
}

/** Bounded producer seam. The caller supplies an already-admitted immutable
 * source slice and independently pinned authority, not request parameters. */
export async function preparePriceCardBlock({manifest,market,sourceChunk,part,offers,sourceInputSha256,
 fx,pricingFingerprint,freshSourceValidUntil,priceReplay}:{manifest:CatalogManifest;market:PreparedMarket;sourceChunk:string;part:number;
 offers:readonly VehicleOffer[];sourceInputSha256:string;fx:CatalogFxBatch;pricingFingerprint:string;freshSourceValidUntil?:number;priceReplay?:FreshChinaPriceReplay}){
 const entry=manifest.markets?.[market];
 if(!markets.includes(market)||!entry?.chunks.includes(sourceChunk)||!chunk.test(sourceChunk)||
    !Number.isSafeInteger(part)||part<0||part>1000||!offers.length||offers.length>MAX_ROWS||offers.length>entry.count||
    !sha.test(pricingFingerprint)||!sha.test(sourceInputSha256)||fx.receipt.market!==market)return fail('scope');
 const lockedOffers=structuredClone([...offers]);
 const inputBytes=jsonBytes(lockedOffers), ids=lockedOffers.map(row=>row.id);
 if(inputBytes.length>MAX_BYTES||hashBytes(inputBytes)!==sourceInputSha256||
    ids.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_:-]{1,150}$/.test(id))||new Set(ids).size!==ids.length)return fail('source_input');
 if(lockedOffers.some(row=>row.market!==market||row.status!=='active'||row.catalogPricingMode==='seller'||row.editorialPriceKey||
     row.deliveryCity||hasModificationSelection(row)||!Number.isFinite(row.sourcePrice)||!(row.sourcePrice!>0)||!row.sourceCurrency))return fail('source_eligibility');
 // An unanchored China USD input would consult mutable anchor storage. Require
 // the existing producer to resolve and bind that source observation first.
 if(market==='china'&&lockedOffers.some(row=>row.sourceCurrency!=='CNY'))return fail('china_source_not_anchored');
 const asOf=Date.parse(fx.receipt.pricingAsOf), calculationVersion=calculationCacheVersion();
 if(freshSourceValidUntil!==undefined&&(market!=='china'||!Number.isSafeInteger(freshSourceValidUntil)||freshSourceValidUntil<=asOf||
   freshSourceValidUntil>asOf+48*3600000))return fail('fresh_source_horizon');
 if(!sha.test(calculationVersion))return fail('calculation_version');
 const binding:Binding={version:1,generationId:manifest.generationId,market,marketInventoryDigest:preparedPriceCardMarketDigest(manifest,market),
  sourceChunk,part,sourceInputSha256,sourceIdsSha256:preparedPriceCardDigest(ids),calculationVersion,
  pricingFingerprint,fxReceiptSha256:fx.receiptSha256,pricingAsOf:fx.receipt.pricingAsOf,policyDay:policyDay(asOf),rows:ids.length,...(freshSourceValidUntil===undefined?{}:{freshSourceValidUntil})};
 return withCatalogFxBatch(fx,async()=>{
  if(await budgetPricingFingerprint(market)!==pricingFingerprint)return fail('price_context');
  const prepared=priceReplay
   ?await readFreshChinaPreparedPrices(priceReplay,lockedOffers,fx,pricingFingerprint,calculationVersion)
   :await applyActiveBusinessPriceBatch(lockedOffers,{readOnly:true,retainFullSnapshot:true});
  const details=prepared.map((row,i)=>validatedPreparedPriceDetail(row,lockedOffers[i],fx,binding));
  // The compact numeric index is derived from exactly the same full results.
  // The full offer never goes into this artifact, only the engine's ledger.
  const projection={generationId:binding.generationId,items:prepared.map(searchProjectionFromOffer)};
  if(projection.items.some((row,i)=>!projectionCanRenderCard(row)||row.totalRub!==details[i].totalRub))return fail('public_projection');
  const indexInputs=projection.items.map((row,i)=>({...row,calculationSnapshot:prepared[i].calculationSnapshot}));
  const index=buildBudgetCountIndex(binding.generationId,indexInputs,new Map(),3);
  // Do not carry replay inputs in the readback index: it is a result only.
  index.rows=index.rows.map(row=>row.slice(0,7) as typeof row);
  const tariffValidUntil=Math.min(freshSourceValidUntil??Infinity,...prepared.map(row=>fxTariffHorizon(row,asOf)));
  const legal=freshSourceValidUntil===undefined?null:prepared.map(row=>certifiedFxTariffHorizon(row,asOf));
  const legalValidUntil=legal?.every(v=>v!==null)?Math.min(...legal as number[]):undefined;
  const legalProof=legalValidUntil===undefined?{}:{legalValidUntil};
  if(Date.now()>=tariffValidUntil||binding.freshSourceValidUntil===undefined&&policyDay(Date.now())!==binding.policyDay)return fail('tariff_or_inventory_horizon');
  if(await budgetPricingFingerprint(market)!==pricingFingerprint||calculationCacheVersion()!==calculationVersion)return fail('price_context');
  const projectionBytes=jsonBytes(projection), projectionSha256=hashBytes(projectionBytes);
  const bytes=jsonBytes({binding,tariffValidUntil,...legalProof,projectionSha256,index,details});
  if(bytes.length>MAX_BYTES||projectionBytes.length>MAX_BYTES)return fail('artifact_size');
  const descriptor:PreparedPriceCardDescriptor={...binding,bytes:bytes.length,contentSha256:hashBytes(bytes),projectionSha256,tariffValidUntil,...legalProof};
  verifyPriceCardBlock(bytes,descriptor);
  return {bytes,descriptor,path:preparedPriceCardBlockPath(descriptor),projection,projectionSha256};
 });
}

export function preparedChinaCalculationIncomplete(row:VehicleOffer,pricingAsOf:string){
 const s=row.calculationSnapshot,when=s?.customsInput?.importedAt;
 const imported=when instanceof Date?when.toISOString():when;
 return row.editorialPriceKey||row.catalogPricingMode==='seller'||
  !['ready','estimated'].includes(row.calculationStatus)||!Number.isSafeInteger(row.totalRub)||!(row.totalRub!>0)||
  s?.customs?.status!=='ready'||s.priceIncludesAllCustoms!==true||s.priceIncludesUtilizationFee!==true||
  s.missing?.length||s.businessRepricedAt!==pricingAsOf||imported!==pricingAsOf;
}
function validatedPreparedPriceDetail(row:VehicleOffer,input:VehicleOffer,fx:CatalogFxBatch,binding:Binding):Detail{
 if(row.id!==input.id||row.market!==binding.market||preparedChinaCalculationIncomplete(row,binding.pricingAsOf))
  return fail('calculation_incomplete');
 const s=row.calculationSnapshot,rate=s.currencyRate,eur=s.eurRate;
 if(!row.sourceCurrency||!exactRate(rate,fx,row.sourceCurrency)||rate.sourcePrice!==row.sourcePrice||
    !exactRate(eur,fx,'EUR')||s.customsInput.eurRateRub!==eur.effectiveRate)return fail('frozen_rate');
 const {sourceTitle:_sourceTitle,...customsInput}=s.customsInput;
 const ledger=Object.fromEntries(ledgerKeys.filter(key=>s[key]!==undefined)
  .map(key=>[key,key==='customsInput'?customsInput:s[key]])) as Ledger;
 const detail={id:row.id,totalRub:row.totalRub!,calculationStatus:row.calculationStatus,ledger};
 assertLedger(detail,binding);
 return detail;
}

function exactRate(rate:any,fx:CatalogFxBatch,code:string){
 const expected=fx.receipt.rates[code];
 return !!expected&&!!rate&&['currency','cbrRate','nominal','effectiveRate','rateDate','rateSource','fetchedAt'].every(key=>
  rate[key]===expected[key as keyof typeof expected]);
}

function assertLedger(detail:Detail,binding:Binding){
 const ledger=detail?.ledger, lines=ledger?.breakdown;
 const wholesale=lines?.map(line=>line?.id);
 if(!Array.isArray(lines)||lines.length<3||lines.length>128||!wholesale?.includes('car')||
    !wholesale.includes('customs')||!wholesale.includes('utilization-fee')||
    wholesale.some(id=>typeof id!=='string'||!id)||new Set(wholesale).size!==lines.length||
    lines.some(line=>!Number.isSafeInteger(line.amountRub))||lines.reduce((sum,line)=>sum+line.amountRub,0)!==detail.totalRub||
    ledger.customs?.status!=='ready'||ledger.priceIncludesAllCustoms!==true||ledger.priceIncludesUtilizationFee!==true||
    ledger.businessRepricedAt!==binding.pricingAsOf) return fail('ledger');
 const customs=ledger.customs as {knownCustomsRub?:number;utilizationFeeRub?:number;totalCustomsRub?:number;breakdown?:unknown[]};
 const duty=lines.find(line=>line.id==='customs')!.amountRub, util=lines.find(line=>line.id==='utilization-fee')!.amountRub;
 if(!Array.isArray(customs.breakdown)||!customs.breakdown.length||duty!==customs.knownCustomsRub||util!==customs.utilizationFeeRub||
    duty+util!==customs.totalCustomsRub) return fail('customs_ledger');
 const importedAt=(ledger.customsInput as {importedAt?:Date|string}|undefined)?.importedAt;
 if((importedAt instanceof Date?importedAt.toISOString():importedAt)!==binding.pricingAsOf)return fail('ledger_context');
}

/** Authenticate exact immutable bytes against an independently allowed descriptor. */
export function verifyPriceCardBlock(bytes:Buffer,ref:PreparedPriceCardDescriptor):Block {
 preparedPriceCardBlockPath(ref);
 const {contentSha256,projectionSha256,bytes:expectedBytes,tariffValidUntil,legalValidUntil,...binding}=ref;
 if(!Buffer.isBuffer(bytes)||bytes.length!==expectedBytes||bytes.length>MAX_BYTES||hashBytes(bytes)!==contentSha256||
    ref.version!==1||!Number.isSafeInteger(ref.rows)||ref.rows<1||ref.rows>MAX_ROWS||
    !Number.isFinite(Date.parse(ref.pricingAsOf))||ref.policyDay!==policyDay(Date.parse(ref.pricingAsOf))||
    (ref.freshSourceValidUntil!==undefined&&(ref.market!=='china'||!Number.isSafeInteger(ref.freshSourceValidUntil)||ref.freshSourceValidUntil> Date.parse(ref.pricingAsOf)+48*3600000||tariffValidUntil>ref.freshSourceValidUntil))||
    legalValidUntil!==undefined&&(ref.freshSourceValidUntil===undefined||!Number.isSafeInteger(legalValidUntil)||legalValidUntil<tariffValidUntil)||
    !Number.isSafeInteger(tariffValidUntil)||tariffValidUntil<=Date.parse(ref.pricingAsOf)||
    ![ref.sourceInputSha256,ref.sourceIdsSha256,ref.marketInventoryDigest,ref.calculationVersion,
      ref.pricingFingerprint,ref.fxReceiptSha256,projectionSha256].every(value=>sha.test(value)))return fail('artifact_identity');
 const block=JSON.parse(bytes.toString('utf8')) as Block;
 if(preparedPriceCardDigest(block.binding)!==preparedPriceCardDigest(binding)||block.tariffValidUntil!==tariffValidUntil||block.legalValidUntil!==legalValidUntil||block.projectionSha256!==projectionSha256||
    !Array.isArray(block.details)||block.details.length!==ref.rows||block.index.version!==3||block.index.otherRows?.length||
    block.index.generationId!==ref.generationId||block.index.sourceRows!==ref.rows||block.index.rows.length!==ref.rows)return fail('scope_coverage');
 const ids=block.details.map(row=>row.id);
 if(new Set(ids).size!==ref.rows||preparedPriceCardDigest(ids)!==ref.sourceIdsSha256)return fail('scope_ids');
 for(let i=0;i<ref.rows;i++){
  const row=block.index.rows[i], detail=block.details[i];
  if(row[0]!==ref.market||row[5]?.id!==detail.id||row[1]!==detail.totalRub||row[4]||row.length>7||
     !Number.isSafeInteger(detail.totalRub)||detail.totalRub<=0||!['ready','estimated'].includes(detail.calculationStatus)||
     preparedPriceCardDigest(row[2])!==preparedPriceCardDigest(deliveryPricingBasis(detail.ledger)||null)||
     (row[6]??null)!==(includedDepositCost(detail.ledger)??null))
   return fail('price_parity');
  assertLedger(detail,binding);
 }
 return block;
}

/** Shadow only. ref is supplied by reviewed staging authority, never a URL.
 * Load one block from the exact active generation, not the whole market. */
export async function readShadowActivePriceCardBlock(storage:JsonStorage,ref:PreparedPriceCardDescriptor, now=Date.now()){
 if(!storage.getBinary)return null;
 const read=()=>storage.readJsonWithMeta<CatalogManifest|null>('catalog/manifest.json',null);
 const base=await read(), manifest=base.value, market=manifest?.markets?.[ref.market];
 if(!base.found||!base.etag||!manifest||manifest.generationId!==ref.generationId||
    !market?.chunks.includes(ref.sourceChunk)||market.count<ref.rows||
    ref.marketInventoryDigest!==preparedPriceCardMarketDigest(manifest,ref.market)||
    ref.calculationVersion!==calculationCacheVersion()||!Number.isFinite(now)||Date.parse(ref.pricingAsOf)>now||
    ref.freshSourceValidUntil===undefined&&ref.policyDay!==policyDay(now)||now>=ref.tariffValidUntil)return null;
 const manifestDigest=preparedPriceCardDigest(manifest);
 const stored=await storage.getBinary(preparedPriceCardBlockPath(ref));
 const block=verifyPriceCardBlock(stored.data,ref), current=await read();
 const finished=Math.max(now,Date.now());
 if(!current.found||current.etag!==base.etag||preparedPriceCardDigest(current.value)!==manifestDigest||
    finished>=ref.tariffValidUntil||ref.freshSourceValidUntil===undefined&&policyDay(finished)!==ref.policyDay)return null;
 return block;
}

/** Only a bounded comparison reader, not an implementation of market search. */
export function shadowPriceCardValues(block:Block,params:Pick<CatalogSearchParams,'budgetFrom'|'budgetTo'>,offerId:string){
 const rows=matchingBudgetIndex(block.index,{...params,market:block.binding.market});
 const detail=block.details.find(row=>row.id===offerId)||null;
 return {generationId:block.binding.generationId,market:block.binding.market,blockCount:rows.length,
  items:rows.map(row=>({id:row[5].id,totalRub:row[1]})),detail};
}
