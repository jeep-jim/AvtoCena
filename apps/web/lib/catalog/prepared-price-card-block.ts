import {deliveryPricingBasis} from "./card-city-delivery";
import {includedDepositCost} from "./deposit-cost-projection";
import type {CatalogManifest} from './storage';
import {createHash} from 'node:crypto';
import type {JsonStorage} from '../data';
import {matchingBudgetIndex,type BudgetCountIndex} from './budget-count-index';
import {calculationCacheVersion} from './shared-budget-prices';
import {validPreparedChinaEditorialSpecifications} from './china-prepared-editorial.mjs';
import type {EditorialSpecifications} from './editorial-specifications';
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
type Detail={id:string;totalRub:number;calculationStatus:VehicleOffer['calculationStatus'];ledger:Ledger;editorialSpecifications?:EditorialSpecifications};
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
function assertLedger(detail:Detail,binding:Binding){
 if(detail.editorialSpecifications!==undefined&&(binding.market!=='china'||binding.freshSourceValidUntil===undefined||
    !validPreparedChinaEditorialSpecifications(detail.editorialSpecifications)))return fail('editorial_specifications');
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
