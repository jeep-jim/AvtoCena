import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
const file=fs.readFileSync(new URL('../apps/web/lib/catalog/prepared-china-fresh-price-replay.ts',import.meta.url),'utf8');
const hash=v=>createHash('sha256').update(v).digest('hex');
const a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64),day=new Date(Date.now()-60000).toISOString(),legalValidUntil=Date.now()+3600000;
const fx={receiptSha256:a,receipt:{market:'china',pricingAsOf:day}};
const rows=[1,2].map(id=>({id:String(id),market:'china',status:'active',sourceCurrency:'CNY',sourcePrice:id*100,sourceOfferId:String(id)}));
const price=r=>({...r,totalRub:r.sourcePrice*37,calculationSnapshot:{customsInput:{importedAt:new Date(day)}}});
let calls=0;
const deps={hash,fail:(x)=>{throw Error(x)},sha:/^[a-f0-9]{64}$/,withCatalogFxBatch:(_,f)=>f(),
 budgetPricingFingerprint:async()=>b,calculationCacheVersion:()=>c,
 preparedChinaEditorialEvidence:()=>({}),readCatalogEditorialFresh:async()=>({}),
 exactChe168Identity:(r)=>rows.some(x=>x.id===r.id),preparedChinaCalculationIncomplete:r=>!r?.totalRub,
 projectionCanRenderCard:()=>true,searchProjectionFromOffer:r=>r,exactChe168SourceParameters:()=>null,
 chinaPreparedEditorialOffer:r=>({row:r}),applyActiveBusinessPriceBatch:async items=>{calls+=items.length;await new Promise(r=>setTimeout(r,5));return items.map(price)},
 calculateOfferWithVerifiedSpecifications:()=>{throw Error('not selected')}
};
const shared=file.slice(file.indexOf("const authority=Symbol"),file.indexOf('type CleanDecision='));
const reader=file.slice(file.indexOf('export async function readFreshChinaPreparedPrices'),file.indexOf('/** Private per-job clean'));
const mixed=file.slice(file.indexOf('type VerifiedMixedDecision'));
const impl=stripTypeScriptTypes((shared+reader+mixed).replaceAll('export ','').trim(),{mode:'strip'});
const make=new Function(...Object.keys(deps),impl+'\nreturn {openMixedChinaPriceReplay,readFreshChinaPreparedPrices};');
const {openMixedChinaPriceReplay,readFreshChinaPreparedPrices}=make(...Object.values(deps));
const base={source:{continuitySha256:a,sourceReportSha256:a,nativeAdmissionSha256:a,sourceReplicaSha256:a,sourceBinding:a,sourceCursor:100,sourceExpiresAt:legalValidUntil},
 fx,pricingFingerprint:b,calculationVersion:c,legalValidUntil,expectedChangedRows:1};
const stored=price(rows[0]);
const verify=(wrong=false)=>async()=>({assertCurrent:async()=>{},decision:async id=>id==='1'?{id,action:'frozen',sourceInputSha256:hash(JSON.stringify(rows[0])),previousSourceInputSha256:b,previousReceiptSha256:c}:{id,action:'changed',sourceInputSha256:hash(JSON.stringify(rows[1]))},
 readFrozen:async id=>({id,sourceInputSha256:b,previousReceiptSha256:c,pricedRow:stored,fxReceiptSha256:wrong?b:a,pricingFingerprint:b,calculationVersion:c,pricingAsOf:day,legalValidUntil})});
const opened=await openMixedChinaPriceReplay({...base,verifyTerminalAndPrevious:verify()});
const read=async (rows,token=opened.replay)=>readFreshChinaPreparedPrices(token,rows,fx,b,c);
const both=await Promise.all([read(rows),read([rows[1]])]);assert.equal(calls,1);
assert.equal(both[0][0].totalRub,stored.totalRub);assert.equal(both[1][0].totalRub,price(rows[1]).totalRub);
assert.equal((await opened.finish()).changedRows,1);
await assert.rejects(read(rows,{}),/untrusted_replay/);
opened.close();await assert.rejects(read(rows),/untrusted_replay/);
const bad=await openMixedChinaPriceReplay({...base,verifyTerminalAndPrevious:verify(true)});
await assert.rejects(read([rows[0]],bad.replay),/mixed_frozen_binding/);
assert.equal(calls,1);
console.log('Actual appended seam with mocked verified ports: private capability, preserved frozen quote, concurrent changed row calculated once, wrong receipt/forgery refused');
