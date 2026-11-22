import {getJsonStorage,StorageConflictError} from '../../apps/web/lib/data.ts';
import {catalogRateFingerprintInputs} from '../../apps/web/lib/catalog/rates.ts';
import {installFeedRates} from '../../apps/web/lib/catalog/feed-rate-snapshot.ts';

export async function bindFeedRates(market, mode, {runId=process.env.MARKET_RATE_RUN,storage=getJsonStorage(),capture=catalogRateFingerprintInputs,install=installFeedRates}={}) {
 if (!runId) return;
 if (!['china','korea','uae','europe','georgia'].includes(market) || !/^[1-9]\d*$/.test(runId)) throw Error('invalid_feed_rate_scope');
 const key = 'catalog/feed-rates/v1/'+market+'/'+runId+'.json';
 let snapshot = await storage.readJson(key,null);
 if (!snapshot && mode === 'capture') {
  const capturedAt=new Date().toISOString();
  const rows=await capture();
  const rates={};
  for (const [code,unit,fresh] of rows) {
   if (fresh === false || !unit || !['cbr','cbr_live','moex','atb_akebono'].includes(unit.rateSource) || !(unit.effectiveRate>0)) continue;
   const {sourcePrice,sourcePriceRub,...rate}=unit;
   rates[code]=rate;
  }
  try {await storage.writeJson(key,{version:1,market,runId,capturedAt,rates},{ifNoneMatch:'*'});}
  catch(error){if(!(error instanceof StorageConflictError))throw error;}
  snapshot=await storage.readJson(key,null);
 }
 if (!snapshot || snapshot.market!==market || snapshot.runId!==runId) throw Error('feed_rate_snapshot_missing');
 const required={china:'CNY',korea:'KRW',uae:'AED',europe:'EUR',georgia:'USD'}[market];
 if (mode === 'read' && (!snapshot.rates[required] || !snapshot.rates.EUR || !snapshot.rates.USD))
  throw Error('required_feed_currency_unavailable');
 install(snapshot);
 if (mode === 'read' && market === 'korea') {
  const {effectiveRate, rateSource} = snapshot.rates.KRW;
  console.log(JSON.stringify({stage:'encar_feed_rate', runId, capturedAt:snapshot.capturedAt, currency:'KRW', effectiveRate, rateSource}));
 }
 return snapshot;
}
