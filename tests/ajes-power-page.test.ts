import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAjesPowerPager} from '../apps/web/lib/catalog/ajes-power-page';
import {AjesUnavailable} from '../apps/web/lib/catalog/ajes-access-policy';
const initialTime=Date.parse('2026-11-26T11:00:00Z');
const rows=(prefix:string,count:number,start=0)=>Array.from({length:count},(_,i)=>({id:prefix+(start+i)}));
const source=(items:{id:string}[],received=items.length,flags:any={})=>({items,received,sourceFingerprint:createHash('sha256').update(JSON.stringify(items)).digest('hex'),observedAt:new Date(initialTime).toISOString(),...flags});
const base={query:{market:'japan',powerTo:160,city:'Новокузнецк'},revision:'index+editorial-1',page:1,pageSize:24};
test('cursor metadata never retains or replays read receipts from a source page',async()=>{
 const pager=createAjesPowerPager({now:()=>initialTime});let calls=0;
 const read=async()=>source(rows('K',48),48,{sourceReadReceipt:{readId:`attempt-${++calls}`},
  sourceReadReceipts:[{private:'PRIVATE_SAVED_RECEIPT'}],catalogReadReceipt:{private:'PRIVATE_SAVED_READ'},sourceReadReceiptsLimited:true});
 const first=await pager.read({...base,read}),cached=await pager.read({...base,read}),second=await pager.read({...base,page:2,after:first.nextCursor,read});
 for(const page of [first,cached,second]){
  for(const field of ['sourceReadReceipt','sourceReadReceipts','catalogReadReceipt','sourceReadReceiptsLimited'])assert.equal(field in page,false,field);
  assert.equal(JSON.stringify(page).includes('PRIVATE_'),false);
 }
 assert.equal(calls,3);assert.equal(first.sourceRevision,second.sourceRevision);
 assert.equal(new Set([...first.items,...second.items].map(row=>row.id)).size,48);
});
test('two source phases put every known result before unknowns across full visible pages',async()=>{
 const pager=createAjesPowerPager({now:()=>initialTime}),calls:string[]=[];
 const read=async(phase:'known'|'unknown',page:number,size:number)=>{calls.push(`${phase}.${page}`);assert.equal(size,48);return phase==='known'?source(rows('K',page===1?45:7,page===1?0:45),page===1?48:7):source(rows('U',48,(page-1)*48),48);};
 const first=await pager.read({...base,read});assert.equal(first.items.length,24);assert.deepEqual(calls,['known.1']);
 const second=await pager.read({...base,page:2,after:first.nextCursor,read});assert.equal(second.items.length,24);assert.ok(second.items.every(row=>row.id.startsWith('K')));
 const third=await pager.read({...base,page:3,after:second.nextCursor,read});assert.equal(third.items.length,24);assert.deepEqual(third.items.slice(0,4).map(row=>row.id),['K48','K49','K50','K51']);assert.ok(third.items.slice(4).every(row=>row.id.startsWith('U')));
 const all=[...first.items,...second.items,...third.items];assert.equal(new Set(all.map(row=>row.id)).size,72);
 assert.equal(first.sourceRevision,third.sourceRevision);assert.ok(first.nextCursor!.length<=61);
});
test('ordinary catalogue also fills 24 after source policy exclusions, with no duplicate borrowing',async()=>{
 const pager=createAjesPowerPager({now:()=>initialTime});
 const read=async(phase:string,page:number)=>{assert.equal(phase,'known');return page===1?source(rows('A',23),48):source(rows('B',48),48);};
 const first=await pager.read({...base,query:{market:'japan'},partitioned:false,read});
 const second=await pager.read({...base,query:{market:'japan'},partitioned:false,page:2,after:first.nextCursor,read});
 assert.equal(first.items.length,24);assert.equal(second.items.length,24);assert.equal(first.items.at(-1)!.id,'B0');assert.equal(second.items[0].id,'B1');
});
test('a slow first read cannot consume the second read needed to fill an ordinary page',async()=>{
 let clock=initialTime;const pager=createAjesPowerPager({now:()=>clock});
 const result=await pager.read({...base,read:async(_phase,page)=>{clock+=19_000;return source(rows(`P${page}-`,page===1?23:48),48);}});
 assert.equal(result.items.length,24);assert.equal(result.reads,2);assert.equal(result.partial,false);
});
test('source failure preserves a partial page and retry fills that same page before unknowns',async()=>{
 const pager=createAjesPowerPager({now:()=>initialTime});let failing=true;
 const read=async(phase:string,page:number)=>{assert.equal(phase,'known');if(page===2&&failing)throw new AjesUnavailable('request_timeout');return source(rows(`K${page}-`,page===1?23:48),48);};
 const first=await pager.read({...base,read});assert.equal(first.items.length,23);assert.equal(first.partial,true);assert.equal(first.hasMore,false);assert.ok(first.retryCursor);
 failing=false;const retry=await pager.read({...base,after:first.retryCursor,read});assert.equal(retry.items.length,24);assert.equal(retry.partial,false);assert.equal(new Set(retry.items.map(row=>row.id)).size,24);
 assert.deepEqual(retry.items.slice(0,23),first.items);
});
test('bounded sparse scan has explicit same-page retry, and does not expose unknown ahead of remaining known',async()=>{
 const pager=createAjesPowerPager({now:()=>initialTime});const calls:string[]=[];
 const read=async(phase:string,page:number)=>{calls.push(`${phase}.${page}`);return source(page<9?[]:rows('K',48),48);};
 const first=await pager.read({...base,read});assert.equal(first.items.length,0);assert.equal(first.reads,8);assert.equal(first.scanLimited,true);assert.ok(first.retryCursor);assert.equal(first.hasMore,false);
 const second=await pager.read({...base,after:first.retryCursor,read});assert.equal(second.items.length,24);assert.equal(calls.at(-1),'known.9');assert.ok(calls.every(value=>value.startsWith('known.')));
});
test('stale or partial known rows never prove phase exhaustion or an exact empty catalogue',async()=>{
 for(const flags of [{partial:true},{stale:true},{partial:true,stale:true}]){
  const pager=createAjesPowerPager({now:()=>initialTime});let calls=0;
  const result=await pager.read({...base,read:async phase=>{calls++;assert.equal(phase,'known');return source(rows('saved',3),3,flags);}});
  assert.equal(result.partial,true);assert.equal(result.stale,Boolean(flags.stale));assert.equal(result.items.length,3);assert.equal(result.hasMore,false);assert.equal(calls,1);assert.ok(result.retryCursor);
 }
});
test('direct page 2 is bounded, deep page without a prepared cursor never starts a supplier scan',async()=>{
 const pager=createAjesPowerPager({now:()=>initialTime});let calls=0;
 const read=async()=>{calls++;return source(rows('K',48),48);};
 const second=await pager.read({...base,page:2,read});assert.equal(second.items[0].id,'K24');assert.equal(second.items.length,24);assert.equal(calls,1);
 await assert.rejects(pager.read({...base,query:{...base.query,make:'Different'},page:99999,read}),/ajes_invalid_query/);assert.equal(calls,1);
});
test('cursor binds the full query, visible page, local revision and frozen source observation',async()=>{
 const pager=createAjesPowerPager({now:()=>initialTime});let changed=false,calls=0;
 const read=async()=>{calls++;return source(rows(changed?'changed':'K',48),48);};
 const first=await pager.read({...base,read});
 for(const patch of [{query:{...base.query,city:'Москва'}},{page:3}])await assert.rejects(pager.read({...base,page:2,after:first.nextCursor,read,...patch}),/ajes_invalid_query/);
 await assert.rejects(pager.read({...base,page:2,after:first.nextCursor,read,revision:'index+editorial-2'}),/ajes_cursor_expired/);
 assert.equal(calls,1);
 changed=true;await assert.rejects(pager.read({...base,page:2,after:first.nextCursor,read}),/ajes_cursor_expired/);
});
test('expiry and memory eviction fail explicitly instead of reinterpreting an old cursor as a fresh offset',async()=>{
 let clock=initialTime;const pager=createAjesPowerPager({now:()=>clock,maxSessions:1});
 const read=async()=>source(rows('K',48),48);
 const first=await pager.read({...base,read});await pager.read({...base,query:{...base.query,make:'Other'},read});
 await assert.rejects(pager.read({...base,page:2,after:first.nextCursor,read}),/ajes_cursor_expired/);
 const another=await pager.read({...base,read});clock+=30*60_000;
 await assert.rejects(pager.read({...base,page:2,after:another.nextCursor,read}),/ajes_cursor_expired/);
});
test('parallel continuation consumers share one stable page and do not advance past each other',async()=>{
 const pager=createAjesPowerPager({now:()=>initialTime});
 const read=async(_phase:string,page:number)=>{await new Promise(resolve=>setTimeout(resolve,1));return source(rows(`K${page}-`,48),48);};
 const first=await pager.read({...base,read});
 const seconds=await Promise.all(Array.from({length:3},()=>pager.read({...base,page:2,after:first.nextCursor,read})));
 for(const result of seconds)assert.deepEqual(result.items,seconds[0].items);
 const third=await pager.read({...base,page:3,after:seconds[0].nextCursor,read});assert.equal(third.items[0].id,'K2-0');
});
test('volatile pricing timestamps cannot invalidate an unchanged raw source observation',async()=>{
 const pager=createAjesPowerPager({now:()=>initialTime});let priceReads=0;
 const read=async()=>{const raw=source(rows('K',48),48);return {...raw,items:raw.items.map(row=>({...row,japanDeliveredPreview:{totalRub:500000,currencyRate:{fetchedAt:++priceReads}}}))};};
 const first=await pager.read({...base,read});const second=await pager.read({...base,page:2,after:first.nextCursor,read});
 assert.equal(first.items.length,24);assert.equal(second.items[0].id,'K24');assert.equal(second.sourceRevision,first.sourceRevision);
});
test('changed accepted identities invalidate skip even when raw source and local revisions are unchanged',async()=>{
 const pager=createAjesPowerPager({now:()=>initialTime});let shifted=false;
 const read=async()=>{const raw=source(rows('K',48),48);return {...raw,items:raw.items.slice(shifted?1:0,36)};};
 const first=await pager.read({...base,read});shifted=true;
 await assert.rejects(pager.read({...base,page:2,after:first.nextCursor,read}),/ajes_cursor_expired/);
});
test('rolling page bodies allow deep forward pagination within memory bounds and retain the immediate previous page',async()=>{
 const pager=createAjesPowerPager({now:()=>initialTime,maxBytes:150_000});
 const read=async(_phase:string,page:number)=>{const raw=source(rows(`K${page}-`,48),48);return {...raw,items:raw.items.map(row=>({...row,label:'x'.repeat(700)}))};};
 let result=await pager.read({...base,read});const old=result.nextCursor;
 for(let page=2;page<=15;page++)result=await pager.read({...base,page,after:result.nextCursor,read});
 assert.equal(result.items.length,24);assert.ok(result.previousCursor);
 const previous=await pager.read({...base,page:14,after:result.previousCursor,read});assert.equal(previous.items.length,24);
 const restored=await pager.read({...base,page:2,after:old,read});assert.equal(restored.items[0].id,'K1-24');assert.equal(restored.items.length,24);assert.ok(restored.reads<=2);
});
test('restored mixed-source page preserves stale evidence from every contributing source',async()=>{
 const pager=createAjesPowerPager({now:()=>initialTime});let staleSource=0;
 const read=async(_phase:string,page:number)=>source(rows(`K${page}-`,23),48,{stale:page===staleSource});
 const first=await pager.read({...base,read}),second=await pager.read({...base,page:2,after:first.nextCursor,read});let result=second;
 for(let page=3;page<=7;page++)result=await pager.read({...base,page,after:result.nextCursor,read});
 staleSource=3;const restored=await pager.read({...base,page:2,after:first.nextCursor,read});
 assert.equal(restored.items.length,24);assert.equal(restored.stale,true);assert.equal(restored.partial,true);assert.equal(restored.hasMore,false);
});
test('mixed fresh and saved rows display the oldest contributing observation without extending stale age',async()=>{
 const pager=createAjesPowerPager({now:()=>initialTime}),old=new Date(initialTime-6*24*60*60_000).toISOString();
 const result=await pager.read({...base,read:async(_phase,page)=>source(rows(`K${page}-`,page===1?23:1),48,page===1?{}:{stale:true,observedAt:old})});
 assert.equal(result.items.length,24);assert.equal(result.observedAt,old);assert.equal(result.stale,true);assert.equal(result.partial,true);assert.equal(result.hasMore,false);
});
