import {readCalculationIndex} from '../encyclopedia/calculation-index';
import {readCatalogEditorial} from './editorial';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync,gzip,gunzip} from 'node:zlib';
import {promisify} from 'node:util';
const gzipAsync=promisify(gzip),gunzipAsync=promisify(gunzip);
import {getJsonStorage} from '../data';
import {getEffectiveMarketVersion} from '../effective-market-settings';
import {catalogRateFingerprintInputs} from './rates';
import {chinaCnyPriceFingerprint} from './china-cny-price';
import {resolveCatalogMarketConfig} from './estimated-market-config';
import type {CatalogMarket} from './types';
import type {BudgetCountIndex, BudgetCountRow} from './budget-count-index';
import {DetailReadCache} from './detail-read-cache';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const markets=new Set(['china','korea','uae','europe','georgia']);
export const VERSIONED_CALCULATION_CACHE = true;
export function calculationCacheVersion(){
 const version=process.env.AVTOCENA_CALCULATION_VERSION;
 return version && /^[a-f0-9]{64}$/.test(version) ? version : process.env.AVTOCENA_RELEASE_SHA||'budget-replay-20261009-v1';
}
// Japan has independently mutable delivered-preview inputs. Keep its existing
// exact path until those authorities have a separate versioned contract.
export async function budgetPricingFingerprint(market:string):Promise<string|null> {
 if(!markets.has(market))return null;
 const [rates,configured,anchors,editorial]=await Promise.all([
  catalogRateFingerprintInputs(),getEffectiveMarketVersion(market),
  market==='china'?chinaCnyPriceFingerprint():null,readCatalogEditorial(),
 ]);
 return hash({schema:1,release:calculationCacheVersion(),encyclopedia:readCalculationIndex()?.digest||null,market,
  utcDay:new Date().toISOString().slice(0,10),rates,configured,
  editorialPrices:Object.values(editorial.entries).filter(entry=>entry.market===market&&entry.sellerPrice).map(entry=>[entry.id,entry.sellerPrice]),
  resolved:resolveCatalogMarketConfig(market as CatalogMarket,configured),anchors});
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
export function resetSharedBudgetPriceCache(){cache.clear();}

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
