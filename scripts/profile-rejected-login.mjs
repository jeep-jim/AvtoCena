import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {readPublicFeatures,readShowcase,findDealer} from '../apps/web/lib/dealers/showcase-store.ts';
import {availableShowcase} from '../apps/web/lib/dealers/program-store.ts';
import {withDealerRate} from '../apps/web/lib/dealers/exchange-rate.ts';
import {publicDealerProfile} from '../apps/web/lib/dealers/public-profile.ts';
import {publicRail} from '../apps/web/lib/dealers/public-rail.ts';
import {PILOT_DEALER_ID} from '../apps/web/lib/dealers/showcase-model.ts';

const storage=getJsonStorage();
assert.equal(storage.driver,'object');
const reads=[];
const originalRead=storage.readJsonWithMeta.bind(storage);
storage.readJsonWithMeta=async (...args)=>{
 const started=performance.now();
 try{return await originalRead(...args);}
 finally{const p=String(args[0]);reads.push({path:/^(catalog\/|knowledge\/|settings\/public-features.json$|dealers\/(?:dealers.json$|showcases\/dealer_topavto.json$|rates\/usdrub.json$))/.test(p)?p:'other-read',ms:+(performance.now()-started).toFixed(2)});}
};
for(const name of ['writeJson','deleteJson','putBinary','deleteBinary','deleteObjects','deletePrefix'])storage[name]=async()=>{throw new Error('diagnostic_write_forbidden');};
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{
 const method=String(init?.method||((typeof input==='object'&&input)?input.method:'')||'GET').toUpperCase();
 assert.ok(method==='GET'||method==='HEAD','diagnostic_non_read_request_forbidden');
 return originalFetch(input,init);
};
for(const [phase,wait] of [['initial',0],['after35s',35000],['after65s',65000]]){
 if(wait)await new Promise(r=>setTimeout(r,wait));
 reads.length=0;const stages={};const start=performance.now();
 const measure=async(name,fn)=>{const t=performance.now();try{return await fn();}finally{stages[name]=+(performance.now()-t).toFixed(2);}};
 const [features,dealer]=await Promise.all([
  measure('features',()=>readPublicFeatures()),
  (async()=>{
   const stored=await measure('showcase',()=>readShowcase(PILOT_DEALER_ID));
   const available=stored?.profileEnabled?await measure('available',()=>availableShowcase(stored)):null;
   return available?measure('quotesAndSavedRate',()=>withDealerRate(available)):null;
  })(),
 ]);
 const verified=dealer?.profileEnabled?(await measure('verification',()=>findDealer(PILOT_DEALER_ID)))?.status==='verified':false;
 const profile=dealer?.profileEnabled?publicDealerProfile(dealer):null,items=dealer?.profileEnabled?publicRail(dealer):[];
 console.log('LOGIN_READ_PROFILE',JSON.stringify({phase,totalMs:+(performance.now()-start).toFixed(2),stages,reads,profileEnabled:!!profile,verified,offers:items.length,marketOffers:dealer?.offers.filter(o=>o.availability==='market').length||0,quoteErrors:dealer?.offers.filter(o=>o.availability==='market'&&o.marketQuote?.error).length||0,featureVersion:features.version,itemsDigest:createHash('sha256').update(JSON.stringify(items.map(x=>[x.id,x.price]))).digest('hex'),readOnly:true,runnerNotServingProcess:true,reactRequestMemoizationNotSimulated:true}));
}
