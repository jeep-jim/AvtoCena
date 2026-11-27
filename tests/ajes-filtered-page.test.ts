import test from 'node:test';
import assert from 'node:assert/strict';
import {readFilteredAjesPage,readPowerOrderedAjesPage,ajesPowerEvidenceEpoch,assertAjesPowerCursorEpoch} from '../apps/web/lib/catalog/ajes-filtered-page';
import {AjesCursorRefreshRequired} from '../apps/web/lib/catalog/ajes-query';

test('fills 24 matching cars instead of four and resumes without omissions or repeats',async()=>{
 const calls:number[]=[];
 const read=async(page:number)=>{calls.push(page);return {items:Array.from({length:page===1?4:24},(_,i)=>`${page}/${i}`),received:24};};
 const first=await readFilteredAjesPage({page:1,pageSize:24,read});
 assert.equal(first.items.length,24);assert.equal(first.nextCursor,'2.20');assert.deepEqual(calls,[1,2]);
 const second=await readFilteredAjesPage({page:2,pageSize:24,after:first.nextCursor,read});
 assert.equal(second.items.length,24);assert.equal(second.items[0],'2/20');assert.equal(second.nextCursor,'3.20');
 assert.equal(new Set([...first.items,...second.items]).size,48);
});
test('empty intermediate source pages do not become empty visible pages',async()=>{
 const result=await readFilteredAjesPage({page:1,pageSize:24,read:async page=>({items:page===3?['match']:[],received:page===3?1:24})});
 assert.deepEqual(result.items,['match']);assert.equal(result.hasMore,false);assert.equal(result.nextCursor,null);
});
test('a sparse search stops after eight pages and preserves its continuation',async()=>{
 const result=await readFilteredAjesPage({page:1,pageSize:24,read:async()=>({items:[],received:24})});
 assert.equal(result.reads,8);assert.equal(result.scanLimited,true);assert.equal(result.nextCursor,'9.0');
});
test('time budget stops further reads without claiming exhaustion',async()=>{
 let clock=0;
 const result=await readFilteredAjesPage({page:1,pageSize:24,now:()=>clock,read:async()=>{clock+=9000;return {items:['one'],received:24};}});
 assert.equal(result.reads,1);assert.equal(result.nextCursor,'2.0');assert.equal(result.hasMore,true);
});
test('fresh source total stops an exact source boundary; stale pages cannot use it',async()=>{
 const read=async()=>({items:['match'],received:24});
 assert.equal((await readFilteredAjesPage({page:1,pageSize:24,sourceTotal:24,read})).hasMore,false);
 assert.equal((await readFilteredAjesPage({page:1,pageSize:24,sourceTotal:24,read:async()=>({...await read(),stale:true})})).hasMore,true);
});
test('partial fallback stays partial and never triggers a crawl',async()=>{
 const result=await readFilteredAjesPage({page:1,pageSize:24,read:async()=>({items:['saved'],received:24,partial:true,stale:true})});
 assert.equal(result.reads,1);assert.equal(result.partial,true);assert.equal(result.stale,true);assert.equal(result.hasMore,false);
});
test('rejects malformed continuation before reading the supplier',async()=>{
 for(const after of ['0.0','-1.0','1000001.0','1.24','1.999','NaN','1.0;select'])await assert.rejects(readFilteredAjesPage({page:1,pageSize:24,after,read:async()=>{throw Error('must not read');}}),/ajes_invalid_query/);
});
test('supplier refusal propagates without presenting an empty success',async()=>{
 await assert.rejects(readFilteredAjesPage({page:1,pageSize:24,read:async()=>{throw Error('disabled');}}),/disabled/);
});

 test('a later supplier outage preserves matches and resumes at the failed page',async()=>{
 const {AjesUnavailable}=await import('../apps/web/lib/catalog/ajes-client');
 const result=await readFilteredAjesPage({page:1,pageSize:24,read:async page=>{if(page===2)throw new AjesUnavailable('request_timeout');return {items:['saved'],received:24};}});
 assert.deepEqual(result.items,['saved']);assert.equal(result.interrupted,true);assert.equal(result.partial,true);assert.equal(result.stale,false);assert.equal(result.nextCursor,'2.0');assert.equal(result.hasMore,true);
 });


test('Japan opts into one refill after a slow first read without changing the generic time bound',async()=>{
 let clock=0;const calls:number[]=[];
 const result=await readFilteredAjesPage({page:1,pageSize:24,minimumReads:2,now:()=>clock,read:async page=>{
  calls.push(page);clock+=9000;return {items:Array.from({length:page===1?23:24},(_,i)=>page+'/'+i),received:24};
 }});
 assert.deepEqual(calls,[1,2]);assert.equal(result.items.length,24);assert.equal(result.nextCursor,'2.1');
 clock=0;
 const sparse=await readFilteredAjesPage({page:1,pageSize:24,minimumReads:2,now:()=>clock,read:async()=>{clock+=9000;return {items:[],received:24};}});
 assert.equal(sparse.reads,2);assert.equal(sparse.scanLimited,true);assert.equal(sparse.nextCursor,'3.0');
});
test('bound 24-row cursors fill 23 candidates and partition a finite source with no duplicate or skipped ID',async()=>{
 const calls:number[]=[],all=[...Array.from({length:23},(_,i)=>'1/'+i),...Array.from({length:24},(_,i)=>'2/'+i),'3/0','3/1'];
 const read=async(page:number)=>{calls.push(page);return {items:page===1?all.slice(0,23):page===2?all.slice(23,47):all.slice(47),received:page<3?24:2};};
 const options={pageSize:24,cursorKey:'japan|petrol|160|city',itemKey:(id:string)=>id,read};
 const first=await readFilteredAjesPage({...options,page:1});
 assert.equal(first.items.length,24);assert.match(first.nextCursor!,/^j1\.2\.1\.2\.[a-f0-9]{64}\.[a-f0-9]{64}$/);
 const second=await readFilteredAjesPage({...options,page:2,after:first.nextCursor});
 assert.equal(second.items.length,24);assert.match(second.nextCursor!,/^j1\.3\.1\.3\./);
 const third=await readFilteredAjesPage({...options,page:3,after:second.nextCursor});
 assert.deepEqual([...first.items,...second.items,...third.items],all);
 assert.equal(new Set([...first.items,...second.items,...third.items]).size,49);
 assert.equal(third.items.length,1);assert.equal(third.hasMore,false);assert.equal(third.nextCursor,null);
 assert.deepEqual(calls,[1,2,2,3,3],'only the explicitly requested 24-row source pages are read');
});
test('bound cursors reject another query, city or visible page before reading and reject changed accepted membership before skipping',async()=>{
 let calls=0,changed=false;
 const options={pageSize:24,cursorKey:'japan|petrol|160|Новокузнецк',itemKey:(row:{id:string;price:number})=>row.id,
  read:async(page:number)=>{calls++;return {received:24,items:Array.from({length:page===1?23:24},(_,i)=>({id:page+'/'+(changed&&page===2?23-i:i),price:100+calls}))};}};
 const first=await readFilteredAjesPage({...options,page:1});const before=calls;
 for(const patch of [{page:2,cursorKey:'japan|petrol|160|Казань'},{page:2,cursorKey:'japan|petrol|100|Новокузнецк'},{page:3}])
  await assert.rejects(readFilteredAjesPage({...options,page:2,after:first.nextCursor,...patch}),/ajes_invalid_query/);
 assert.equal(calls,before);
 const second=await readFilteredAjesPage({...options,page:2,after:first.nextCursor});
 assert.equal(second.items[0].id,'2/1','price/timestamp changes do not change the membership fingerprint');
 changed=true;const beforeChanged=calls;
 await assert.rejects(readFilteredAjesPage({...options,page:2,after:first.nextCursor}),/ajes_invalid_query/);
 assert.equal(calls,beforeChanged+1,'changed IDs are refused on the exact partly consumed page before any next page is read');
});
test('a mixed page retains the oldest source observation and every stale/partial flag',async()=>{
 const result=await readFilteredAjesPage({page:1,pageSize:24,read:async page=>({
  items:Array.from({length:page===1?23:24},(_,i)=>page+'/'+i),received:24,
  observedAt:page===1?'2026-11-26T12:00:00.000Z':'2026-11-26T11:00:00.000Z',stale:page===2,partial:page===2,
 })});
 assert.equal(result.observedAt,'2026-11-26T11:00:00.000Z');
 assert.equal(result.stale,true);assert.equal(result.partial,true);assert.equal(result.hasMore,false);
 assert.equal(result.items.length,24);assert.equal(result.nextCursor,null);
});

const epoch=ajesPowerEvidenceEpoch({runtimeSha:'1'.repeat(40),editorialRevision:'editorial-1',calculationDigest:null});
const observedAt='2026-11-27T10:00:00.000Z';
type PowerRow={id:string;known:boolean};
const powerRows=(page:number,count:number)=>Array.from({length:count},(_,i)=>({id:page+'/'+i,known:i%3!==0}));
const powerOptions={pageSize:24,evidenceEpoch:epoch,cursorKey:'japan|petrol|160|Новокузнецк',
 itemKey:(row:PowerRow)=>row.id,known:(row:PowerRow)=>row.known,now:()=>0};

test('power traversal emits every known row before every unknown row with one bounded budget and exact cursors',async()=>{
 const pages=[powerRows(1,24),powerRows(2,24),powerRows(3,5)],calls:{page:number;phase:string}[]=[];
 const read=async(page:number,phase:string)=>{calls.push({page,phase});const items=pages[page-1]||[];return {items,received:items.length,observedAt};};
 const all=pages.flat(),expected=[...all.filter(row=>row.known),...all.filter(row=>!row.known)];
 const results=[];let after:string|null|undefined;
 for(let page=1;page<10;page++){
  const before=calls.length,result=await readPowerOrderedAjesPage({...powerOptions,page,after:after??undefined,read});
  assert(calls.length-before<=8);results.push(result);after=result.nextCursor;
  if(!result.hasMore)break;
 }
 const actual=results.flatMap(result=>result.items);
 assert.deepEqual(actual,expected);assert.equal(new Set(actual.map(row=>row.id)).size,53);
 assert.deepEqual(results.map(result=>result.items.length),[24,24,5]);
 assert.match(results[0].nextCursor!,/^j2\.k\./);assert.match(results[1].nextCursor!,/^j2\.u\./);
 assert.equal(results.at(-1)!.nextCursor,null);
 const firstUnknownRead=calls.findIndex(call=>call.phase==='u');
 assert(calls.slice(0,firstUnknownRead).some(call=>call.page===3));
});

test('eight empty known source pages preserve an explicit continuation and never expose unknown early',async()=>{
 const calls:{page:number;phase:string}[]=[];
 const read=async(page:number,phase:string)=>{
  calls.push({page,phase});const items=page<=8?powerRows(page,24).map(row=>({...row,known:false})):
   page===9?powerRows(page,24).map(row=>({...row,known:true})):[];
  return {items,received:items.length,observedAt};
 };
 const first=await readPowerOrderedAjesPage({...powerOptions,page:1,read});
 assert.equal(first.items.length,0);assert.equal(first.reads,8);assert(first.hasMore&&first.scanLimited);
 assert.match(first.nextCursor!,/^j2\.k\.9\.0\.2\./);assert(calls.every(call=>call.phase==='k'));
 const second=await readPowerOrderedAjesPage({...powerOptions,page:2,after:first.nextCursor!,read});
 assert.equal(second.items.length,24);assert(second.items.every(row=>row.known));
 const third=await readPowerOrderedAjesPage({...powerOptions,page:3,after:second.nextCursor!,read});
 assert.equal(third.items.length,24);assert(third.items.every(row=>!row.known));
 assert.deepEqual(calls.slice(-2),[{page:10,phase:'k'},{page:1,phase:'u'}]);
});

test('a phase boundary shares the eight-read cap and the original time budget',async()=>{
 let clock=0;
 const calls:{page:number;phase:string}[]=[];
 const read=async(page:number,phase:string)=>{
  calls.push({page,phase});clock+=100;
  const items=page<7?powerRows(page,24).map(row=>({...row,known:false})):[];
  return {items,received:items.length,observedAt};
 };
 const result=await readPowerOrderedAjesPage({...powerOptions,page:1,pageSize:24,read,now:()=>clock});
 assert.equal(result.reads,8);assert.equal(result.items.length,24);assert.deepEqual(calls.at(-1),{page:1,phase:'u'});
 clock=0;calls.length=0;
 const slow=await readPowerOrderedAjesPage({...powerOptions,page:1,now:()=>clock,read:async(page,phase)=>{
  calls.push({page,phase});clock+=9000;return {items:[{id:'only',known:false}],received:1,observedAt};
 }});
 assert.equal(slow.reads,1);assert.equal(slow.items.length,0);assert.match(slow.nextCursor!,/^j2\.u\.1\.0\.2\./);
 const minimum=await readPowerOrderedAjesPage({...powerOptions,page:1,minimumReads:2,now:()=>clock,read:async()=>{
  clock+=9000;return {items:[],received:24,observedAt};
 }});
 assert.equal(minimum.reads,2);
});

test('stale, partial and missing-observation ends never authorize the unknown phase',async()=>{
 for(const flags of [{stale:true},{partial:true},{observedAt:undefined}]){
  const calls:string[]=[];
  const result=await readPowerOrderedAjesPage({...powerOptions,page:1,read:async(_page,phase)=>{
   calls.push(phase);return {items:[{id:'known',known:true},{id:'unknown',known:false}],received:2,observedAt,...flags};
  }});
  assert.deepEqual(calls,['k']);assert.deepEqual(result.items.map(row=>row.id),['known']);
  assert(result.hasMore);assert.match(result.nextCursor!,/^j2\.k\.1\.1\.2\./);
 }
});

test('a stale full known page is rechecked at consumed24 before advancing, without a duplicate',async()=>{
 const rows=powerRows(1,24).map(row=>({...row,known:true}));let stale=true;
 const calls:{page:number;phase:string}[]=[];
 const read=async(page:number,phase:string)=>{calls.push({page,phase});return {items:page===1?rows:[],received:page===1?24:0,observedAt,stale};};
 const first=await readPowerOrderedAjesPage({...powerOptions,page:1,read});
 assert.equal(first.items.length,24);assert.match(first.nextCursor!,/^j2\.k\.1\.24\.2\./);
 stale=false;
 const last=await readPowerOrderedAjesPage({...powerOptions,page:2,after:first.nextCursor!,read});
 assert.equal(last.items.length,0);assert.equal(last.hasMore,false);
 assert.deepEqual(calls,[{page:1,phase:'k'},{page:1,phase:'k'},{page:2,phase:'k'},{page:1,phase:'u'},{page:2,phase:'u'}]);
});

test('a later source failure resumes the exact known offset and cannot switch phase',async()=>{
 const {AjesUnavailable}=await import('../apps/web/lib/catalog/ajes-client');
 let fail=true;const calls:number[]=[];
 const read=async(page:number)=>{
  calls.push(page);if(page===2&&fail)throw new AjesUnavailable('request_timeout');
  return {items:page===1?[{id:'one',known:true}]:[],received:page===1?24:0,observedAt};
 };
 const first=await readPowerOrderedAjesPage({...powerOptions,page:1,read});
 assert.deepEqual(first.items,[{id:'one',known:true}]);assert(first.partial&&first.interrupted);
 assert.match(first.nextCursor!,/^j2\.k\.2\.0\.2\./);
 fail=false;const last=await readPowerOrderedAjesPage({...powerOptions,page:2,after:first.nextCursor!,read});
 assert.equal(last.hasMore,false);assert.deepEqual(last.items,[]);assert.deepEqual(calls,[1,2,2,1,2]);
});

test('power cursors bind query, epoch and visible page; legacy positions request a reset before source reads',async()=>{
 let calls=0;
 const read=async()=>{calls++;return {items:powerRows(1,24),received:24,observedAt};};
 const first=await readPowerOrderedAjesPage({...powerOptions,page:1,read});const before=calls;
 for(const patch of [{evidenceEpoch:'f'.repeat(64)},{cursorKey:'another-city'},{page:3},
  {after:'2.3'},{after:'j1.2.1.2.'+'a'.repeat(64)+'.'+'b'.repeat(64)},{after:undefined}])
  await assert.rejects(readPowerOrderedAjesPage({...powerOptions,page:2,after:first.nextCursor!,read,...patch}),AjesCursorRefreshRequired);
 assert.equal(calls,before);
 const oversized=first.nextCursor!.split('.');oversized[3]='25';
 assert.throws(()=>assertAjesPowerCursorEpoch({page:2,pageSize:24,evidenceEpoch:epoch,after:oversized.join('.')}),AjesCursorRefreshRequired);
});

test('local evidence identity changes the hashed epoch without exposing private revision text',()=>{
 const value={runtimeSha:'1'.repeat(40),editorialRevision:'private-editorial-revision',calculationDigest:'a'.repeat(64)};
 const original=ajesPowerEvidenceEpoch(value);assert.match(original,/^[a-f0-9]{64}$/);
 for(const patch of [{runtimeSha:'2'.repeat(40)},{editorialRevision:'next-revision'},{calculationDigest:'b'.repeat(64)},{calculationDigest:null}])
  assert.notEqual(ajesPowerEvidenceEpoch({...value,...patch}),original);
 for(const patch of [{runtimeSha:''},{editorialRevision:''},{calculationDigest:'bad'}])
  assert.throws(()=>ajesPowerEvidenceEpoch({...value,...patch}),/not_configured/);
});

test('changed consumed membership requests refresh instead of silently moving the phase boundary',async()=>{
 let changed=false,calls=0;
 const read=async(page:number)=>{
  calls++;const rows=powerRows(page,24).map(row=>({...row,known:true}));
  const items=page===1?rows.slice(0,23):changed?[...rows].reverse():rows;
  return {items,received:24,observedAt};
 };
 const first=await readPowerOrderedAjesPage({...powerOptions,page:1,read});assert.match(first.nextCursor!,/^j2\.k\.2\.1\.2\./);
 changed=true;const before=calls;
 await assert.rejects(readPowerOrderedAjesPage({...powerOptions,page:2,after:first.nextCursor!,read}),AjesCursorRefreshRequired);
 assert.equal(calls,before+1);
});
