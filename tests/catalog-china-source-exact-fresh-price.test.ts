import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {normalizeAutoApiChe168} from '../apps/web/lib/catalog/auto-api-che168';
import {readFreshChinaPreparedPrices,openFreshChinaPriceReplay,type CleanChinaPriceSourceProof} from '../apps/web/lib/catalog/prepared-china-fresh-price-replay';
import {captureCatalogFxBatch,withCatalogFxBatch,resetCatalogRateCache} from '../apps/web/lib/catalog/rates';
import {getJsonStorage} from '../apps/web/lib/data';
import {budgetPricingFingerprint} from '../apps/web/lib/catalog/shared-budget-prices';
import {applyActiveBusinessPriceBatch} from '../apps/web/lib/catalog/live-business-pricing';
import {calculateOfferWithVerifiedSpecifications} from '../apps/web/lib/catalog/customs-pricing';
import {calculateRussiaCustomsForIndividual} from '../packages/engine/src/calculation/russiaCustomsV2';
import {resetChinaCnyPriceCache} from '../apps/web/lib/catalog/china-cny-price';
import {resetCatalogEditorialCache} from '../apps/web/lib/catalog/editorial';
import {invalidateEffectiveMarketsCache} from '../apps/web/lib/effective-market-settings';
import {preparedPriceCardDigest,preparePriceCardBlock,verifyPriceCardBlock} from '../apps/web/lib/catalog/prepared-price-card-block';
import type {VehicleOffer} from '../apps/web/lib/catalog/types';

const asOf=Date.parse('2026-11-20T23:59:59Z'),observedAt='2026-11-20T20:00:00.000Z',snapshot='a'.repeat(64),cursor=13123821;
function sourceRow(id:string,kw:string,hp:string,cc:string,engine_type='Бензиновый',table=true):VehicleOffer{
 const o=normalizeAutoApiChe168({inner_id:id,data:{inner_id:id,url:'https://www.che168.com/dealer/451591/'+id+'.html',
  mark:'BMW',model:'X3',configuration:'fixture exact '+id,year:'2021',price:'98000',km_age:'10',first_registration:'2022-09',
  engine_type,transmission_type:'автоматическая',drive_type:'полный привод',displacement:'2.0',power:hp,
  ice_power_ps:hp,ice_power_kw:kw,specid:'57217',body_type:'внедорожник',
  images:JSON.stringify(['https://2sc2.autoimg.cn/escimg/auto/g31/car.jpg.webp']),
  extra:{configuration:{specid:table?57217:57218,paramtypeitems:[{name:'发动机',paramitems:[{name:'排量(mL)',value:cc}]}]}}}},observedAt)!;
 assert.ok(o);
 return {...o,operational:{...o.operational,che168ActiveVerification:{
  method:'snapshot_and_complete_change_stream',snapshotBinding:snapshot,cursor,initialCursor:10,verifiedAt:observedAt,
 }}};
}

test('pinned Che168 unpriced mapper source reaches unchanged native customs; 272 kW stays exact and missing evidence does not become sold',async t=>{
 t.mock.timers.enable({apis:['Date'],now:asOf});
 const old={rate:process.env.CATALOG_LIVE_RATE_DISABLED,calc:process.env.AVTOCENA_CALCULATION_VERSION,fetch:globalThis.fetch};
 const version='c'.repeat(64);
 process.env.CATALOG_LIVE_RATE_DISABLED='1';process.env.AVTOCENA_CALCULATION_VERSION=version;
 let offersByNetwork=0,rateReads=0;
 globalThis.fetch=async()=>{offersByNetwork++;throw Error('offline fixture');};
 const db=getJsonStorage(),prior={readJsonWithMeta:db.readJsonWithMeta,readJson:db.readJson,writeJson:db.writeJson};
 db.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
  if(key==='fees/exchange-rates.json'){
   rateReads++;return {found:true,value:{rates:[['CNY',12.5],['USD',85],['EUR',95]].map(([currency,cbrRate])=>
    ({currency,cbrRate,nominal:1,rateDate:'2026-11-20',rateSource:'cbr'}))} as T};
  }
  assert.ok(['markets/markets.json','catalog-editorial/current.json','catalog/china-cny-prices/current.json'].includes(key),key);
  return {found:false,value:fallback};
 };
 db.readJson=async<T>(key:string,fallback:T)=>(await db.readJsonWithMeta(key,fallback)).value;
 db.writeJson=async()=>assert.fail('no public writes');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'china-fresh-exact-native-'));
 try{
  resetCatalogRateCache();resetChinaCnyPriceCache();resetCatalogEditorialCache();invalidateEffectiveMarketsCache();
  const fx=await captureCatalogFxBatch('china',['CNY']);
  const fingerprint=await withCatalogFxBatch(fx,()=>budgetPricingFingerprint('china'));
  const big=sourceRow('50837330','272','370','2998'),ice=sourceRow('50837332','141','192','1998'),
   missing=sourceRow('50837331','141','192','1998','Бензиновый',false),ev=sourceRow('50837333','272','370','1998','Электрический');
  const conflict=sourceRow('50837334','272','192','1998');
  const inputs=[big,ice,missing,ev,conflict];
  assert.ok(inputs.every(r=>r.totalRub===null&&r.calculationStatus==='needs_data'));
  assert.equal(big.powerKw,272);assert.equal(big.icePowerKw,272);assert.equal((big.operational.semanticEvidence as any).powerKw,undefined);
  const legacy=await withCatalogFxBatch(fx,()=>applyActiveBusinessPriceBatch(inputs,{readOnly:true,retainFullSnapshot:true}));
  assert.ok(legacy.every(r=>r.totalRub===null),'baseline proves source-only hole');
  const source={continuitySha256:'1'.repeat(64),sourceReportSha256:'2'.repeat(64),nativeAdmissionSha256:'3'.repeat(64),
   sourceReplicaSha256:'4'.repeat(64),sourceCursor:cursor,sourceExpiresAt:asOf+60_000,sourceBinding:snapshot};
  const digest=createHash('sha256').update('china-full-fresh-source-ordered-input-v1\n');
  const dispositions=inputs.map(row=>{const d={id:row.id,inputSha256:preparedPriceCardDigest(row)};digest.update(JSON.stringify(d)+'\n');return {...d,state:'eligible_unpriced' as const};});
  const proof:CleanChinaPriceSourceProof={...source,version:1,kind:'china-full-fresh-source-admission-only',
   coverage:'materialized_complete_replica_after_committed_delta',oldRowsMerged:false,sourceRows:inputs.length,eligibleUnpricedRows:inputs.length,
   excludedRows:0,explicitlyWithdrawnRows:0,orderedInputSha256:digest.digest('hex'),priced:false,publicationAuthorized:false,cursorAdvanceAuthorized:false};
  const job=await openFreshChinaPriceReplay({directory:path.join(root,'avtocena-china-fresh-prices-source-exact'),
   fx,pricingFingerprint:fingerprint,calculationVersion:version,expectedInputRows:inputs.length,source,async assertSourceAuthority(){}});
  try{
   const priced=await job.consume({rows:inputs,dispositions});
   assert.deepEqual(priced.map(r=>r.state),['admitted','admitted','excluded','excluded','excluded']);
   const {replay,counts}=await job.seal({proof,proofSha256:preparedPriceCardDigest(proof)});
   assert.equal(counts.admitted,2);assert.equal(counts.withdrawn,0);
   const exact=await readFreshChinaPreparedPrices(replay,[big,ice],fx,fingerprint,version);
   for(const [i,row]of exact.entries()){
    const original=[big,ice][i],kw=[272,141][i];
    const nativeInput={...original,operational:{...original.operational,semanticEvidence:{
     ...original.operational.semanticEvidence,powerKw:{status:'exact' as const,value:kw,source:'source parity declaration'},
    }}};
    const native=await withCatalogFxBatch(fx,()=>calculateOfferWithVerifiedSpecifications(nativeInput));
    assert.equal(row.powerKw,kw);assert.equal(row.icePowerKw,kw);assert.equal(row.calculationSnapshot.customs.utilizationPowerKw,kw);
    assert.equal(row.totalRub,native.totalRub);
    assert.deepEqual(row.calculationSnapshot.breakdown,native.calculationSnapshot.breakdown);
    assert.deepEqual(row.calculationSnapshot.customs,calculateRussiaCustomsForIndividual(row.calculationSnapshot.customsInput));
    assert.equal(row.calculationSnapshot.businessRepricedAt,fx.receipt.pricingAsOf);
    assert.equal(original.productionDate,undefined,'registration was not promoted to manufacturing');
   }
   const offers=[big,ice],generationId='gen_1790001000000_che168source';
   const block=await preparePriceCardBlock({manifest:{version:2,generationId,updatedAt:observedAt,
    markets:{china:{count:2,chunks:['chunk-0001'],updatedAt:observedAt}}},market:'china',sourceChunk:'chunk-0001',part:0,offers,
    sourceInputSha256:preparedPriceCardDigest(offers),fx,pricingFingerprint:fingerprint,priceReplay:replay,
    freshSourceValidUntil:source.sourceExpiresAt});
   const checked=verifyPriceCardBlock(block.bytes,block.descriptor);
   assert.deepEqual(checked.details.map(r=>r.totalRub),exact.map(r=>r.totalRub));
   assert.deepEqual(checked.details.map(r=>r.ledger.customs.utilizationPowerKw),[272,141]);
   assert.equal(rateReads,1);assert.equal(offersByNetwork,0);
  }finally{job.close();}
  const forged={...big,operational:{...big.operational,che168ActiveVerification:{...big.operational.che168ActiveVerification,snapshotBinding:'b'.repeat(64)}}};
  const wrong=await openFreshChinaPriceReplay({directory:path.join(root,'avtocena-china-fresh-prices-wrong'),
   fx,pricingFingerprint:fingerprint,calculationVersion:version,expectedInputRows:1,source,async assertSourceAuthority(){}});
  try{await assert.rejects(wrong.consume({rows:[forged],dispositions:[{id:forged.id,inputSha256:preparedPriceCardDigest(forged),state:'eligible_unpriced'}]}),/native_source_identity/);}
  finally{wrong.close();}
 }finally{
  await fs.rm(root,{recursive:true,force:true});
  Object.assign(db,prior);globalThis.fetch=old.fetch;
  for(const [k,v]of [['CATALOG_LIVE_RATE_DISABLED',old.rate],['AVTOCENA_CALCULATION_VERSION',old.calc]] as const)
   if(v===undefined)delete process.env[k];else process.env[k]=v;
 }
});
