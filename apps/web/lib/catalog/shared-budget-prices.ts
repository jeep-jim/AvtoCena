import {createHash} from 'node:crypto';
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
// Japan has independently mutable delivered-preview inputs. Keep its existing
// exact path until those authorities have a separate versioned contract.
export async function budgetPricingFingerprint(market:string):Promise<string|null> {
 if(!markets.has(market))return null;
 const [rates,configured,anchors]=await Promise.all([
  catalogRateFingerprintInputs(),getEffectiveMarketVersion(market),
  market==='china'?chinaCnyPriceFingerprint():null,
 ]);
 return hash({schema:1,release:process.env.AVTOCENA_RELEASE_SHA||'budget-replay-20261009-v1',market,
  utcDay:new Date().toISOString().slice(0,10),rates,configured,
  resolved:resolveCatalogMarketConfig(market as CatalogMarket,configured),anchors});
}

type Price=[id:string,total:number,basis:BudgetCountRow[2],seller:boolean,deposit:number|null];
type Snapshot={version:1;key:string;sourceIds:string;createdAt:number;prices:Price[];checksum:string};
const cache=new DetailReadCache<BudgetCountRow[]>({maxEntries:6,maxBytes:48*1024*1024,ttlMs:86400000,concurrency:2});
export function resetSharedBudgetPriceCache(){cache.clear();}

function validBasis(value:any):boolean {
 return value===null || (value && Number.isFinite(value.subtotalRub) && Number.isFinite(value.deliveryRub)
  && Array.isArray(value.percents) && value.percents.every((x:any)=>Number.isFinite(x)&&x>=0));
}
/** Validate identity/completeness provenance before using any externally stored result. */
export function restoreBudgetPrices(value:any,key:string,source:BudgetCountRow[],now=Date.now()):BudgetCountRow[]|null {
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
 load:()=>Promise<BudgetCountRow[]>,fingerprintNow=()=>budgetPricingFingerprint(market)) {
 const source=index.rows.filter(row=>row[0]===market);
 const sourceIds=hash(source.map(row=>row[5].id));
 const key=hash([index.generationId,market,fingerprint,sourceIds]);
 return cache.get(key,async()=>{
  const storage=getJsonStorage();
  const path=`catalog/runtime-budget-prices-v1/${market}.json`;
  const stored=await storage.readJson<Snapshot|null>(path,null).catch(()=>null);
  const restored=restoreBudgetPrices(stored,key,source);
  if(restored)return restored;
  const rows=await load();
  // Rates/settings/anchors can change while a large market is being repriced.
  // Never persist that mixed result as reusable under either version.
  if(await fingerprintNow()!==fingerprint)throw new Error('catalog_budget_context_changed');
  const prices:Price[]=rows.map(row=>[row[5].id,row[1],row[2],row[4],row[6]??null]);
  const snapshot:Snapshot={version:1,key,sourceIds,createdAt:Date.now(),prices,checksum:hash(prices)};
  if(!restoreBudgetPrices(snapshot,key,source))throw new Error('catalog_budget_snapshot_invalid');
  // Atomic object replacement; racing instances can only replace with another
  // fully validated version. A reader checks the key, never just the path.
  await storage.writeJson(path,snapshot).catch(()=>undefined);
  return rows;
 });
}
