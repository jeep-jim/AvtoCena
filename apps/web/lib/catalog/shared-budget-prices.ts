import {readCalculationIndex} from '../encyclopedia/calculation-index';
import {readCatalogEditorial} from './editorial';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync,gzip,gunzip} from 'node:zlib';
import {promisify} from 'node:util';
const gzipAsync=promisify(gzip),gunzipAsync=promisify(gunzip);
import {getJsonStorage,StorageConflictError} from '../data';
import {getEffectiveMarketVersion} from '../effective-market-settings';
import {catalogRateFingerprintInputs} from './rates';
import {chinaCnyPriceFingerprint} from './china-cny-price';
import {resolveCatalogMarketConfig} from './estimated-market-config';
import type {CatalogMarket} from './types';
import type {BudgetCountIndex, BudgetCountRow} from './budget-count-index';
import {DetailReadCache} from './detail-read-cache';
import {budgetIndexBytes} from './budget-row-size';
import {publishSelectorMarket,readCompressedSelector,MAX_PUBLISHED_SELECTOR_BYTES} from './budget-selector-publication';
import type {CompressedBudgetDirectory} from './budget-selector-codec';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const markets=new Set(['china','korea','uae','europe','georgia']);
export const VERSIONED_CALCULATION_CACHE = true;
export function calculationCacheVersion(){
 const version=process.env.AVTOCENA_CALCULATION_VERSION;
 return version && /^[a-f0-9]{64}$/.test(version) ? version : process.env.AVTOCENA_RELEASE_SHA||'budget-replay-20261009-v1';
}
function calculationRateInputs(rates:Awaited<ReturnType<typeof catalogRateFingerprintInputs>>){
 return rates.map(row=>{
  const [currency,rate,fresh]=row;
  if(!rate || typeof rate!=='object')return row;
  // A live CBR response and the same saved CBR quote have identical calculation
  // authority. History describes the rate widget, not the current conversion.
  // Keep quote/date/nominal/freshness and non-CBR authority differences intact.
  const {previousEffectiveRate:_previous,previousRateDate:_previousDate,rateDelta:_delta,...quote}=rate;
  return [currency,{...quote,rateSource:quote.rateSource==='cbr_live'?'cbr':quote.rateSource},fresh];
 });
}
// Japan has independently mutable delivered-preview inputs. Keep its existing
// exact path until those authorities have a separate versioned contract.
export async function budgetPricingFingerprint(market:string):Promise<string|null> {
 if(!markets.has(market))return null;
 const [rates,configured,anchors,editorial]=await Promise.all([
  catalogRateFingerprintInputs(),getEffectiveMarketVersion(market),
  market==='china'?chinaCnyPriceFingerprint():null,readCatalogEditorial(),
 ]);
 const calculationConfig=configured?.logisticsRateSource==='cbr_live'?{...configured,logisticsRateSource:'cbr'}:configured;
 return hash({schema:2,release:calculationCacheVersion(),encyclopedia:readCalculationIndex()?.digest||null,market,
  utcDay:new Date().toISOString().slice(0,10),rates:calculationRateInputs(rates),configured:calculationConfig,
  editorialPrices:Object.values(editorial.entries).filter(entry=>entry.market===market&&entry.sellerPrice).map(entry=>[entry.id,entry.sellerPrice]),
  resolved:resolveCatalogMarketConfig(market as CatalogMarket,calculationConfig),anchors});
}

type Price=[id:string,total:number,basis:BudgetCountRow[2],seller:boolean,deposit:number|null];
type Snapshot={version:1;key:string;sourceIds:string;createdAt:number;prices:Price[];checksum:string};
type SnapshotWire=Snapshot|{encoding:'gzip-base64';payload:string};
const MAX_SNAPSHOT_BYTES=64*1024*1024;
export function encodeBudgetSnapshot(snapshot:Snapshot):SnapshotWire{
 const json=JSON.stringify(snapshot);
 return Buffer.byteLength(json)<65536 ? snapshot : {encoding:'gzip-base64',payload:gzipSync(json,{level:6}).toString('base64')};
}
async function decodeBudgetSnapshotAsync(value:any):Promise<any>{
 if(value?.encoding!=='gzip-base64')return value;
 if(typeof value.payload!=='string'||value.payload.length>MAX_SNAPSHOT_BYTES*2)return null;
 try{const bytes=Buffer.from(value.payload,'base64');if(bytes.toString('base64')!==value.payload)return null;return JSON.parse((await gunzipAsync(bytes,{maxOutputLength:MAX_SNAPSHOT_BYTES})).toString('utf8'));}catch{return null;}
}
async function encodeBudgetSnapshotAsync(snapshot:Snapshot):Promise<SnapshotWire>{
 const json=JSON.stringify(snapshot);
 return Buffer.byteLength(json)<65536?snapshot:{encoding:'gzip-base64',payload:(await gzipAsync(json,{level:6})).toString('base64')};
}
function decodeBudgetSnapshot(value:any):any{
 if(value?.encoding!=='gzip-base64')return value;
 if(typeof value.payload!=='string'||value.payload.length>MAX_SNAPSHOT_BYTES*2)return null;
 try{
  const bytes=Buffer.from(value.payload,'base64');
  if(bytes.toString('base64')!==value.payload)return null;
  return JSON.parse(gunzipSync(bytes,{maxOutputLength:MAX_SNAPSHOT_BYTES}).toString('utf8'));
 }catch{return null;}
}
// The five markets' budget+sort tuples measure ~148 MB before rich metadata.
// Keep the active working set together instead of evicting a market on each toggle.
const cache=new DetailReadCache<BudgetCountRow[]>({maxEntries:16,maxBytes:256*1024*1024,ttlMs:86400000,concurrency:2});
export function resetSharedBudgetPriceCache(){cache.clear();preparedSelectionCache.clear();}

function validBasis(value:any):boolean {
 return value===null || (value && Number.isFinite(value.subtotalRub) && Number.isFinite(value.deliveryRub)
  && Array.isArray(value.percents) && value.percents.every((x:any)=>Number.isFinite(x)&&x>=0));
}
/** Validate identity/completeness provenance before using any externally stored result. */
export function restoreBudgetPrices(value:any,key:string,source:BudgetCountRow[],now=Date.now()):BudgetCountRow[]|null {
 value=decodeBudgetSnapshot(value);
 if(!value || value.version!==1 || value.key!==key || value.sourceIds!==hash(source.map(row=>row[5].id))
  || !Number.isFinite(value.createdAt) || value.createdAt>now || now-value.createdAt>86400000
  || !Array.isArray(value.prices) || value.checksum!==hash(value.prices))return null;
 const originals=new Map(source.map(row=>[row[5].id,row]));
 const seen=new Set<string>(),rows:BudgetCountRow[]=[];
 for(const price of value.prices){
  if(!Array.isArray(price)||price.length!==5)return null;
  const [id,total,basis,seller,deposit]=price,original=originals.get(id);
  if(!original||seen.has(id)||!Number.isFinite(total)||total<=0||typeof seller!=='boolean'
    ||!validBasis(basis)||(deposit!==null&&(!Number.isFinite(deposit)||deposit<0)))return null;
  seen.add(id);rows.push([original[0],total,basis,original[3],seller,original[5],deposit??undefined]);
 }
 return rows;
}

/** Read only an already prepared, validated price snapshot. A miss must not
 * start or join whole-market calculation from a narrow model request. */
export async function readPreparedBudgetPrices(index:BudgetCountIndex,market:string,fingerprint:string,displayPrices=false) {
 const source=[...index.rows,...(index.otherRows||[])].filter(row=>row[0]===market);
 const sourceIds=hash(source.map(row=>row[5].id));
 const key=hash([index.generationId,market,fingerprint,sourceIds,...(displayPrices?["display-price-v2"]:[])]);
 const present=cache.peekFresh(key);if(present)return present;
 try {
  return await cache.get(key,async()=>{
   const path=`catalog/${displayPrices?"runtime-sort-prices-v3":"runtime-budget-prices-v3"}/${market}/${key}.json`;
   const stored=await getJsonStorage().readJson<SnapshotWire|null>(path,null);
   const restored=restoreBudgetPrices(await decodeBudgetSnapshotAsync(stored),key,source);
   if(!restored)throw Error('catalog_prepared_price_unavailable');
   return restored;
  },`${key}:prepared-only`);
 } catch { return null; }
}

/** One bounded object per market, shared across server instances. It is a
 * disposable calculation cache, never a catalog writer or published cursor.
 * A failed/mismatched cache always executes the existing exact calculation.
 */
export async function sharedBudgetPrices(index:BudgetCountIndex,market:string,fingerprint:string,
 load:()=>Promise<BudgetCountRow[]>,fingerprintNow=()=>budgetPricingFingerprint(market),displayPrices=false) {
 const source=[...index.rows,...(index.otherRows||[])].filter(row=>row[0]===market);
 const sourceIds=hash(source.map(row=>row[5].id));
 const key=hash([index.generationId,market,fingerprint,sourceIds,...(displayPrices?["display-price-v2"]:[])]);
 return cache.get(key,async()=>{
  const storage=getJsonStorage();
  // A separate namespace preserves plain v1 snapshots for an old instance or rollback.
  const path=`catalog/${displayPrices?"runtime-sort-prices-v3":"runtime-budget-prices-v3"}/${market}/${key}.json`;
  const stored=await storage.readJson<SnapshotWire|null>(path,null).catch(()=>null);
  const restored=restoreBudgetPrices(await decodeBudgetSnapshotAsync(stored),key,source);
  if(restored)return restored;
  const rows=await load();
  // Rates/settings/anchors can change while a large market is being repriced.
  // Never persist that mixed result as reusable under either version.
  if(await fingerprintNow()!==fingerprint)throw new Error('catalog_budget_context_changed');
  const prices:Price[]=rows.map(row=>[row[5].id,row[1],row[2],row[4],row[6]??null]);
  const snapshot:Snapshot={version:1,key,sourceIds,createdAt:Date.now(),prices,checksum:hash(prices)};
  if(!restoreBudgetPrices(snapshot,key,source))throw new Error('catalog_budget_snapshot_invalid');
  // Different releases/generations/rates write different objects. A candidate
  // can never evict the active release snapshot during blue/green preparation.
  await storage.writeJson(path,await encodeBudgetSnapshotAsync(snapshot)).catch(()=>undefined);
  return rows;
 });
}

type PreparedSelectionReceipt={
 version:1;generationId:string;market:string;fingerprint:string;key:string;createdAt:number;
 sourceRows:number;sourceIds:string;sourceChecksum:string;pricesChecksum:string;
 index:Omit<BudgetCountIndex,'rows'|'otherRows'|'pricingChunks'>;
 directory:CompressedBudgetDirectory;checksum:string;
};
// Measured five-market working set is 132,832,926 serialized bytes. Bound
// the combined cache to 192 MiB, with headroom for growth and no full-index JSON string.
// Serialized bytes are not heap bytes; keep serving-process memory checks.
const preparedSelectionCache=new DetailReadCache<BudgetCountIndex>({maxEntries:10,maxBytes:192*1024*1024,ttlMs:86400_000,concurrency:2,sizeOf:budgetIndexBytes});
const preparedSelectionKey=(generationId:string,market:string,fingerprint:string)=>hash([generationId,market,fingerprint]);
const preparedSelectionPrefix=(market:string,key:string)=>`catalog/runtime-budget-selections-v1/${market}/${key}`;
const priceTuples=(rows:BudgetCountRow[])=>rows.map(row=>[row[5].id,row[1],row[2],row[4],row[6]??null]);

async function readPreparedSelection(generationId:string,market:string,fingerprint:string){
 const key=preparedSelectionKey(generationId,market,fingerprint),prefix=preparedSelectionPrefix(market,key);
 const storage=getJsonStorage(),receipt=await storage.readJson<PreparedSelectionReceipt|null>(`${prefix}/ready.json`,null);
 if(!receipt)return null;
 const {checksum,...body}=receipt;
 if(receipt.version!==1||receipt.generationId!==generationId||receipt.market!==market||receipt.fingerprint!==fingerprint||receipt.key!==key
  ||checksum!==hash(body)||Buffer.byteLength(JSON.stringify(receipt))>MAX_PUBLISHED_SELECTOR_BYTES
  ||!Number.isFinite(receipt.createdAt)||receipt.createdAt>Date.now()||Date.now()-receipt.createdAt>86400_000
  ||!Number.isSafeInteger(receipt.sourceRows)||receipt.sourceRows<0
  ||![receipt.sourceIds,receipt.sourceChecksum,receipt.pricesChecksum].every(value=>/^[a-f0-9]{64}$/.test(value))
  ||receipt.index?.version!==3||receipt.index.generationId!==generationId||receipt.index.inventoryPolicyVersion!==1
  ||receipt.index.filterVersion!==1||receipt.index.specificationFilterVersion!==1||receipt.index.bodyFilterVersion!==1
  ||!Number.isSafeInteger(receipt.index.sourceRows)||receipt.index.sourceRows<0||receipt.index.sourceRows>receipt.sourceRows
  ||receipt.directory?.version!==4||receipt.directory.generationId!==generationId)return null;
 const index=receipt.index.sourceRows===0
  ?Object.keys(receipt.directory.markets).length===0?{...receipt.index,rows:[],otherRows:[]}:null
  :await readCompressedSelector(receipt.directory,market,name=>storage.readJson(`${prefix}/${name}.json`,null));
 if(!index||index.sourceRows!==receipt.index.sourceRows||index.otherRows?.length!==0||hash(priceTuples(index.rows))!==receipt.pricesChecksum
  ||new Set(index.rows.map(row=>row[5].id)).size!==index.rows.length
  ||index.rows.some(row=>row[0]!==market||!Number.isFinite(row[1])||row[1]<=0||!validBasis(row[2])||typeof row[4]!=='boolean')
  ||JSON.stringify(Object.keys(receipt.directory.markets))!==JSON.stringify(index.rows.length?[market]:[]))return null;
 const {rows,otherRows,pricingChunks,...header}=index;
 if(JSON.stringify(header)!==JSON.stringify(receipt.index))return null;
 return {index,receipt};
}

/** Complete current price membership plus its filter metadata. This does not
 * replace the inventory selector: unknown-price cars remain in the catalogue.
 * A budget query already requires a known delivered price, so it needs only
 * these rows instead of every unpriced car in the country. */
export async function readPreparedBudgetSelection(generationId:string,market:string,fingerprint:string):Promise<BudgetCountIndex|null>{
 if(!markets.has(market))return null;
 const key=preparedSelectionKey(generationId,market,fingerprint);
 try{return await preparedSelectionCache.get(key,async()=>{
  const result=await readPreparedSelection(generationId,market,fingerprint);
  if(!result)throw Error('catalog_prepared_selection_unavailable');
  return result.index;
 });}catch{return null;}
}

/** Preparation only. Verify the complete existing price snapshot, preserve its
 * exact source metadata, write bounded content-addressed parts, then readiness.
 * No visitor calls this writer, and failed persistence cannot report readiness. */
export async function prepareBudgetSelection(index:BudgetCountIndex,market:string,fingerprint:string,pricedRows:BudgetCountRow[],fingerprintNow=()=>budgetPricingFingerprint(market)){
 if(!markets.has(market)||index.version!==3||index.inventoryPolicyVersion!==1||index.filterVersion!==1
  ||index.specificationFilterVersion!==1||index.bodyFilterVersion!==1)throw Error('catalog_prepared_selection_source_invalid');
 const source=[...index.rows,...(index.otherRows||[])].filter(row=>row[0]===market);
 const sourceIds=hash(source.map(row=>row[5].id)),sourceChecksum=hash({...index,rows:source,otherRows:[],pricingChunks:undefined});
 const originals=new Map(source.map(row=>[row[5].id,row]));
 if(originals.size!==source.length)throw Error('catalog_prepared_selection_source_invalid');
 const rows=pricedRows.map(row=>{
  const original=originals.get(row[5].id);
  if(!original||row[0]!==market||JSON.stringify(row[5])!==JSON.stringify(original[5]))throw Error('catalog_prepared_selection_identity');
  return row.slice(0,7) as BudgetCountRow;
 });
 const pricesChecksum=hash(priceTuples(rows));
 const key=preparedSelectionKey(index.generationId,market,fingerprint),prefix=preparedSelectionPrefix(market,key),storage=getJsonStorage();
 // Read back the numeric snapshot independently of the process cache. A failed
 // write in the older disposable-cache path cannot yield a prepared selector.
 const numericKey=hash([index.generationId,market,fingerprint,sourceIds]);
 const stored=await storage.readJson<SnapshotWire|null>(`catalog/runtime-budget-prices-v3/${market}/${numericKey}.json`,null);
 const numeric=restoreBudgetPrices(await decodeBudgetSnapshotAsync(stored),numericKey,source);
 if(!numeric||hash(priceTuples(numeric))!==pricesChecksum||new Set(rows.map(row=>row[5].id)).size!==rows.length)throw Error('catalog_prepared_selection_prices_invalid');
 if(await fingerprintNow()!==fingerprint)throw Error('catalog_budget_context_changed');
 const existing=await readPreparedSelection(index.generationId,market,fingerprint);
 if(existing){
  if(existing.receipt.sourceChecksum!==sourceChecksum||existing.receipt.pricesChecksum!==pricesChecksum)throw Error('catalog_prepared_selection_conflict');
  return existing.receipt;
 }
 const {rows:_rows,otherRows:_otherRows,pricingChunks:_pricingChunks,...sourceHeader}=index;
 const header={...sourceHeader,sourceRows:rows.length};
 const directory:CompressedBudgetDirectory={version:4,generationId:index.generationId,markets:{}};
 if(rows.length)directory.markets[market]=await publishSelectorMarket({...header,rows,otherRows:[]},market,
  name=>storage.readJson(`${prefix}/${name}.json`,null),
  (name,value)=>storage.writeJson(`${prefix}/${name}.json`,value));
 if(await fingerprintNow()!==fingerprint)throw Error('catalog_budget_context_changed');
 const body={version:1 as const,generationId:index.generationId,market,fingerprint,key,createdAt:Date.now(),
  sourceRows:source.length,sourceIds,sourceChecksum,pricesChecksum,index:header,directory};
 const receipt:PreparedSelectionReceipt={...body,checksum:hash(body)};
 if(Buffer.byteLength(JSON.stringify(receipt))>MAX_PUBLISHED_SELECTOR_BYTES)throw Error('catalog_prepared_selection_directory_too_large');
 try{await storage.writeJson(`${prefix}/ready.json`,receipt,{ifNoneMatch:'*'});}
 catch(error){if(!(error instanceof StorageConflictError))throw error;}
 const verified=await readPreparedSelection(index.generationId,market,fingerprint);
 if(!verified||verified.receipt.sourceChecksum!==sourceChecksum||verified.receipt.pricesChecksum!==pricesChecksum)throw Error('catalog_prepared_selection_readback_failed');
 if(await fingerprintNow()!==fingerprint)throw Error('catalog_budget_context_changed');
 return verified.receipt;
}

/** Independent readback for a publisher/release barrier. No calculation,
 * repair, storage write or process-cache receipt can satisfy this check. */
export async function verifyPreparedBudgetSelection(index:BudgetCountIndex,market:string,fingerprint:string){
 const result=await readPreparedSelection(index.generationId,market,fingerprint);
 const source=[...index.rows,...(index.otherRows||[])].filter(row=>row[0]===market);
 const sourceIds=hash(source.map(row=>row[5].id));
 const sourceChecksum=hash({...index,rows:source,otherRows:[],pricingChunks:undefined});
 if(!result||result.receipt.sourceRows!==source.length||result.receipt.sourceIds!==sourceIds
  ||result.receipt.sourceChecksum!==sourceChecksum)throw Error('catalog_prepared_selection_readiness_failed');
 const storage=getJsonStorage();
 const counts=[];
 for(const displayPrices of [false,true]){
  const key=hash([index.generationId,market,fingerprint,sourceIds,...(displayPrices?['display-price-v2']:[])]);
  const path=`catalog/${displayPrices?'runtime-sort-prices-v3':'runtime-budget-prices-v3'}/${market}/${key}.json`;
  const stored=await storage.readJson<SnapshotWire|null>(path,null);
  const rows=restoreBudgetPrices(await decodeBudgetSnapshotAsync(stored),key,source);
  if(!rows||!displayPrices&&hash(priceTuples(rows))!==result.receipt.pricesChecksum)throw Error('catalog_prepared_selection_prices_invalid');
  counts.push(rows.length);
 }
 if(await budgetPricingFingerprint(market)!==fingerprint)throw Error('catalog_budget_context_changed');
 return {...result.receipt,verified:true as const,budgetRows:counts[0],sortRows:counts[1]};
}
