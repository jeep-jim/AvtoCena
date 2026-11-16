import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

function worker(input:Record<string,unknown>={}){
 const result=spawnSync(process.execPath,['--import','tsx','tests/fixtures/catalog-rate-fingerprint-worker.mjs'],{
  cwd:process.cwd(),input:JSON.stringify(input),encoding:'utf8',timeout:15000,
  maxBuffer:2*1024*1024,env:{...process.env,TSX_DISABLE_CACHE:'1'},
 });
 assert.equal(result.status,0,result.stderr||result.error?.message);
 return JSON.parse(result.stdout);
}

test('separate preparation and serving processes reuse both caches for the same live or saved official quote',()=>{
 const prepared=worker({live:true,prepare:true});
 const served=worker({saved:prepared.saved,expectHit:true,history:7,fetchedAt:'another-fetch'});
 assert.equal(prepared.rateSource,'cbr_live');assert.equal(served.rateSource,'cbr');
 assert.equal(prepared.logisticsRateSource,'cbr_live');assert.equal(served.logisticsRateSource,'cbr');
 assert.equal(prepared.effectiveRate,served.effectiveRate);assert.equal(prepared.rateDate,served.rateDate);
 assert.equal(prepared.logisticsRub,served.logisticsRub);assert.equal(prepared.fingerprint,served.fingerprint);
 assert.deepEqual(served.rows,[['a',1500000],['b',2000000]]);
 assert.equal(served.loads,0);assert.equal(served.writes,0);
 assert.equal(served.inputHistory,7,'history remains present in the source; only the cache identity is canonical');
 assert.equal(served.japanFingerprint,null,'Japan retains its existing independent path');
});

test('actual quote, nominal, date, authority, settings, manual price and encyclopedia changes never reuse the old cache',()=>{
 const prepared=worker({live:true,prepare:true});
 for(const change of [
  {krw:0.075},{nominal:100},{krw:6.5,nominal:100},{rateDate:'2026-11-15'},{rateSource:'moex'},
  {deposit:120000},{sellerPrice:12500000},{encyclopediaChanged:true},
  {calculationVersion:'b'.repeat(64)},{now:'2026-11-17T10:00:00.000Z'},
 ]){
  const served=worker({...change,saved:prepared.saved});
  if('krw' in change && change.krw===6.5)assert.equal(served.effectiveRate,prepared.effectiveRate,'the nominal and published quote remain distinct even at an equal conversion ratio');
  assert.notEqual(served.fingerprint,prepared.fingerprint,JSON.stringify(change));
  assert.equal(served.numericHit,false,JSON.stringify(change));
  assert.equal(served.selectionHit,false,JSON.stringify(change));
  assert.equal(served.loads,1,'the existing exact fallback remains available for a genuinely changed context');
 }
});

test('official-rate freshness and scheduled settings still invalidate within the same UTC date',()=>{
 const fresh={now:'2026-11-16T00:00:00.000Z',rateDate:'2026-11-12'};
 const prepared=worker({...fresh,prepare:true});
 const expired=worker({...fresh,now:'2026-11-16T00:00:00.001Z',saved:prepared.saved});
 assert.notEqual(expired.fingerprint,prepared.fingerprint);assert.equal(expired.numericHit,false);
 const scheduled={scheduledAt:'2026-11-16T11:00:00.000Z'};
 const before=worker({...scheduled,now:'2026-11-16T10:59:59.000Z',prepare:true});
 const after=worker({...scheduled,now:'2026-11-16T11:00:01.000Z',saved:before.saved});
 assert.notEqual(after.fingerprint,before.fingerprint);assert.equal(after.numericHit,false);
});

test('China anchor revision remains a distinct calculation input',()=>{
 const prepared=worker({market:'china',prepare:true});
 const served=worker({market:'china',anchor:'second-anchor',saved:prepared.saved});
 assert.notEqual(served.fingerprint,prepared.fingerprint);assert.equal(served.numericHit,false);
 assert.equal(served.selectionHit,false);
});
