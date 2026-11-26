import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {getEventListeners} from 'node:events';
import {createAjesClient,AjesUnavailable,readAjesNon2xxResponseEvidence} from '../apps/web/lib/catalog/ajes-client';
import {ajesQuery,ajesSourceCacheSql} from '../apps/web/lib/catalog/ajes-query';
import {DetailReadCache} from '../apps/web/lib/catalog/detail-read-cache';
import {copyAjesSourceReadReceipt,ajesSourceReadReceiptFromError,copyAjesResponseEvidence} from '../apps/web/lib/catalog/ajes-read-evidence';

const ip='203.0.113.71',otherIp='203.0.113.72',release='f'.repeat(40);
const row={ID:'fixture001',MARKA_NAME:'TOYOTA',MODEL_NAME:'COROLLA',YEAR:'2023',AUCTION_TYPE:'2',STATUS:'Sold',FINISH:'100000',PW:'150',TIME:'P'};
const base={password:()=> 'private-password-fixture',assertEnabled:async()=>{},reserve:async()=>{}};
const query={table:'stats' as const,page:1,pageSize:48};
const tick=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
const snapshot=(patch:any={})=>({schemaVersion:2,items:[{id:row.ID,table:'stats'}],page:1,pageSize:48,received:48,rejected:0,observedAt:new Date(Date.now()-3600000).toISOString(),stale:false,...patch});
const receipt=(value:any)=>{const result=copyAjesSourceReadReceipt(value.sourceReadReceipt);assert.ok(result,'a valid read returns its own safe receipt');return result;};
const sqlHash=(sql:string)=>createHash('sha256').update(sql).digest('hex');
function bindRelease(t:any){const before=process.env.AVTOCENA_RELEASE_SHA;process.env.AVTOCENA_RELEASE_SHA=release;t.after(()=>{if(before===undefined)delete process.env.AVTOCENA_RELEASE_SHA;else process.env.AVTOCENA_RELEASE_SHA=before;});}

test('each source, memory and restored read has a new receipt; persistence never receives it',async t=>{
 bindRelease(t);let fetches=0,reserves=0;const saved=new Map<string,any>();
 const deps={...base,reserve:async()=>{reserves++;},saveQuery:async(sql:string,value:any)=>{saved.set(sql,structuredClone(value));},readQuery:async(sql:string)=>saved.get(sql)??null,
  fetcher:async()=>{fetches++;return Response.json([row]);}};
 const client=createAjesClient(deps),first=await client.read(query,ip);await tick();
 const a=receipt(first);assert.equal(a.disposition,'source');assert.equal(a.sourceAttempted,true);assert.equal(a.sourceAttempt?.httpStatus,200);assert.equal(a.reason,null);assert.equal(a.runtimeSha,release);
 const wire=ajesQuery(query).sql,canonical=ajesSourceCacheSql(wire);
 assert.equal(a.wireQuerySha256,sqlHash(wire));assert.equal(a.canonicalQuerySha256,sqlHash(canonical));assert.notEqual(a.wireQuerySha256,a.canonicalQuerySha256);
 assert.equal(a.table,'stats');assert.equal(a.kind,'list');assert.equal(a.pageSize,48);
 assert.equal(Object.keys(first).includes('sourceReadReceipt'),false,'only the explicit public sanitizer can project this field');
 const second=await client.read(query,otherIp),b=receipt(second);
 assert.equal(b.disposition,'memory_cache');assert.equal(b.sourceAttempted,false);assert.equal(b.sourceAttempt,null);assert.notEqual(a.readId,b.readId);
 assert.notEqual(first,second);assert.equal(fetches,1);assert.equal(reserves,1);
 assert.equal(JSON.stringify([...saved.values()]).includes('sourceReadReceipt'),false);
 const restarted=createAjesClient({...deps,fetcher:async()=>{assert.fail('a fresh saved query must not fetch');}}),restored=await restarted.read(query,ip),c=receipt(restored);
 assert.equal(c.disposition,'saved_cache');assert.equal(c.sourceAttempted,false);assert.notEqual(c.readId,a.readId);assert.notEqual(c.readId,b.readId);
 assert.equal(fetches,1);assert.equal(reserves,1);
});

test('a retained stale receipt cannot impersonate a source attempt in a fresh saved response',async()=>{
 const fake={readId:'old-private-read',sourceAttempted:true,sql:'private SQL',clientIp:ip};
 const saved=snapshot({observedAt:new Date().toISOString(),sourceReadReceipt:fake});
 let reads=0;
 const client=createAjesClient({...base,readQuery:async()=>{reads++;return saved;},reserve:async()=>{assert.fail('saved page needs no reservation');},fetcher:async()=>{assert.fail('saved page needs no source');}});
 const first=receipt(await client.read(query,ip)),second=receipt(await client.read(query,ip));
 assert.equal(first.disposition,'saved_cache');assert.equal(first.sourceAttempted,false);assert.notEqual(first.readId,second.readId);assert.equal(reads,1);
 assert.equal(JSON.stringify(first).includes('old-private-read'),false);assert.equal(JSON.stringify(second).includes('private SQL'),false);assert.equal(saved.sourceReadReceipt,fake,'instrumentation does not mutate stored values');
});

test('visitor-wide cooldown exposes only its known detail attempt origin and does not affect another IP',async t=>{
 bindRelease(t);let fetches=0,reserves=0;
 const detailId='private-detail-fixture',detail=snapshot({pageSize:1,received:1,items:[{id:detailId,table:'stats'}]});
 const client=createAjesClient({...base,reserve:async()=>{reserves++;},readQuery:async()=>snapshot(),readDetail:async()=>detail,
  fetcher:async url=>{fetches++;return new URL(String(url)).searchParams.get('ip')===ip?new Response('bot private-password-fixture'):Response.json([row]);}});
 const refused=receipt(await client.read({table:'stats',id:detailId},ip));
 assert.equal(refused.disposition,'source_recovery');assert.equal(refused.sourceAttempted,true);assert.equal(refused.reason,'visitor_restricted');assert.equal(refused.sourceAttempt?.httpStatus,200);
 const recovered=receipt(await client.read(query,ip));
 assert.equal(recovered.disposition,'cooldown_recovery');assert.equal(recovered.sourceAttempted,false);assert.equal(recovered.sourceAttempt,null);assert.equal(recovered.reason,'visitor_restricted');
 assert.equal(recovered.cooldownOrigin?.kind,'detail');assert.equal(recovered.cooldownOrigin?.pageSize,1);assert.equal(recovered.cooldownOrigin?.wireQuerySha256,refused.wireQuerySha256);
 assert.equal(recovered.cooldownOrigin?.attemptStartedAt,refused.sourceAttempt?.startedAt);assert.equal(recovered.cooldownOrigin?.attemptFinishedAt,refused.sourceAttempt?.finishedAt);
 const again=receipt(await client.read(query,ip));assert.notEqual(again.readId,recovered.readId);assert.deepEqual(again.cooldownOrigin,recovered.cooldownOrigin);assert.equal(fetches,1);assert.equal(reserves,1);
 const allowed=receipt(await client.read(query,otherIp));assert.equal(allowed.disposition,'source');assert.equal(allowed.sourceAttempted,true);assert.equal(allowed.cooldownOrigin,undefined);assert.equal(fetches,2);assert.equal(reserves,2);
 const encoded=JSON.stringify(recovered);for(const secret of [ip,detailId,'private-password-fixture','http://','select ','visitorKey','endpoint'])assert.equal(encoded.includes(secret),false,secret);
});

test('query-local failure does not claim to suppress a different source page',async()=>{
 let fetches=0;const client=createAjesClient({...base,readQuery:async sql=>snapshot({page:sql.endsWith('limit 48,48')?2:1}),fetcher:async()=>{fetches++;return fetches===1?new Response('unavailable',{status:503}):Response.json([row]);}});
 const first=receipt(await client.read(query,ip));assert.equal(first.reason,'http_503');
 const cooled=receipt(await client.read(query,ip));assert.equal(cooled.disposition,'cooldown_recovery');assert.equal(cooled.cooldownOrigin?.page,1);assert.equal(fetches,1);
 const different=receipt(await client.read({...query,page:2},ip));assert.equal(different.disposition,'source');assert.equal(different.cooldownOrigin,undefined);assert.equal(fetches,2);
});

test('source queue recovery is a local refusal with no invented attempt or cooldown origin',async t=>{
 const get=DetailReadCache.prototype.get;
 t.mock.method(DetailReadCache.prototype,'get',function(this:DetailReadCache<any>,...args:Parameters<typeof get>){return args[3]==='prepared'?get.apply(this,args):Promise.reject(Error('detail_cache_queue_full'));});
 let reads=0,reserves=0,fetches=0;
 const client=createAjesClient({...base,readQuery:async()=>{reads++;return snapshot();},reserve:async()=>{reserves++;},fetcher:async()=>{fetches++;return Response.json([row]);}});
 const value=await client.read(query,ip),e=receipt(value);
 assert.equal(value.stale,true);assert.equal(e.disposition,'local_recovery');assert.equal(e.sourceAttempted,false);assert.equal(e.reason,'local_busy');assert.equal(e.sourceAttempt,null);assert.equal(e.cooldownOrigin,undefined);
 assert.equal(reads,2,'only the existing canonical and compact compatibility lookups');assert.equal(reserves,0);assert.equal(fetches,0);
});

test('reservation refusal and its cooldown never invent a provider attempt',async()=>{
 let reserves=0,fetches=0;
 const client=createAjesClient({...base,readQuery:async()=>snapshot(),reserve:async()=>{reserves++;throw new AjesUnavailable('quota_busy');},fetcher:async()=>{fetches++;return Response.json([row]);}});
 const first=receipt(await client.read(query,ip)),second=receipt(await client.read(query,ip));
 assert.equal(first.disposition,'local_recovery');assert.equal(first.reason,'quota_busy');assert.equal(first.sourceAttempted,false);assert.equal(first.cooldownOrigin,undefined);
 assert.equal(second.disposition,'cooldown_recovery');assert.equal(second.sourceAttempted,false);assert.equal(second.cooldownOrigin,undefined);assert.notEqual(first.readId,second.readId);
 assert.equal(reserves,1);assert.equal(fetches,0);
});

test('a joined read has unknown shared provenance instead of borrowing another invocation attempt',async()=>{
 let release!:()=>void,started!:()=>void,calls=0;
 const held=new Promise<void>(resolve=>release=resolve),ready=new Promise<void>(resolve=>started=resolve);
 const client=createAjesClient({...base,fetcher:async()=>{calls++;started();await held;return Response.json([row]);}});
 const a=client.read(query,ip),b=client.read(query,ip);
 try{
  await ready;await tick();assert.equal(calls,1);release();
  const [left,right]=await Promise.all([a,b]),first=receipt(left),second=receipt(right);
  assert.equal(first.sourceAttempted,true);assert.equal(first.disposition,'source');assert.equal(second.sourceAttempted,null);assert.equal(second.disposition,'shared_or_cached');assert.equal(second.sourceAttempt,null);assert.notEqual(first.readId,second.readId);
 }finally{release();await Promise.allSettled([a,b]);}
});

test('fixed failures get a fresh error receipt without annotating a shared or arbitrary exception',async()=>{
 let calls=0;const client=createAjesClient({...base,fetcher:async()=>{calls++;return new Response('private body',{status:414});}});
 const errors:any[]=[];
 for(let i=0;i<2;i++)try{await client.read(query,ip);assert.fail('unavailable');}catch(error){errors.push(error);}
 const first=ajesSourceReadReceiptFromError(errors[0])!,second=ajesSourceReadReceiptFromError(errors[1])!;
 assert.ok(first&&second);assert.equal(first.reason,'query_too_large');assert.equal(first.sourceAttempted,true);assert.equal(first.sourceAttempt?.httpStatus,414);
 assert.equal(second.reason,'query_too_large');assert.equal(second.sourceAttempted,false);assert.equal(second.cooldownOrigin?.reason,'query_too_large');assert.notEqual(first.readId,second.readId);assert.notEqual(errors[0],errors[1]);assert.equal(calls,1);
 assert.equal(JSON.stringify(first).includes('private body'),false);assert.equal(Object.keys(errors[0]).includes('sourceReadReceipt'),false);
 const original=Error('private owner failure'),denied=createAjesClient({...base,assertEnabled:async()=>{throw original;}});
 await assert.rejects(denied.read(query,ip),error=>error===original);assert.equal(ajesSourceReadReceiptFromError(original),undefined);assert.equal(Object.hasOwn(original,'sourceReadReceipt'),false);
});

test('known disjoint years and exact zero validation keep the same supplier request counts',async()=>{
 let calls=0,reserves=0;
 const client=createAjesClient({...base,reserve:async()=>{reserves++;},fetcher:async url=>{calls++;return Response.json(new URL(String(url)).searchParams.get('sql')!.startsWith('select count(*)')?[{total:0}]:[]);}});
 const policy=receipt(await client.read({...query,yearTo:2007},ip));assert.equal(policy.disposition,'policy_empty');assert.equal(policy.sourceAttempted,false);assert.equal(calls,0);
 const zero=await client.read(query,ip),e=receipt(zero);assert.deepEqual(zero.items,[]);assert.equal(e.disposition,'source');assert.equal(e.sourceAttempted,true);assert.equal(e.emptyValidation,true);assert.equal(calls,2);assert.equal(reserves,2,'the original list plus exact COUNT only');
 const warmed=receipt(await client.read(query,ip));assert.equal(warmed.sourceAttempted,false);assert.equal(warmed.emptyValidation,undefined);assert.equal(calls,2);assert.notEqual(warmed.readId,e.readId);
});

test('failed exact COUNT is marked as empty validation rather than a malformed LIST response',async()=>{
 let calls=0;const client=createAjesClient({...base,readQuery:async sql=>sql.startsWith('select *')?snapshot():null,fetcher:async()=>{calls++;return Response.json([]);}});
 const first=receipt(await client.read(query,ip));assert.equal(first.disposition,'source_recovery');assert.equal(first.reason,'invalid_response');assert.equal(first.sourceAttempt?.httpStatus,200);assert.equal(first.emptyValidation,true);assert.equal(calls,2);
 const cooled=receipt(await client.read(query,ip));assert.equal(cooled.disposition,'cooldown_recovery');assert.equal(cooled.emptyValidation,undefined);assert.equal(cooled.sourceAttempted,false);assert.equal(calls,2);
});

test('receipt copying strips foreign fields and rejects malformed evidence without throwing',async()=>{
 const valid=receipt(await createAjesClient({...base,fetcher:async()=>Response.json([row])}).read(query,ip));
 const copy=copyAjesSourceReadReceipt({...valid,sql:'private SQL',clientIp:ip,endpoint:'private endpoint',sourceAttempt:{...valid.sourceAttempt,body:'private body'}})!;
 assert.deepEqual(copy,valid);assert.notEqual(copy,valid);assert.notEqual(copy.sourceAttempt,valid.sourceAttempt);assert.equal(JSON.stringify(copy).includes('private'),false);
 for(const patch of [{readId:'arbitrary'},{runtimeSha:'secret'},{wireQuerySha256:'not a hash'},{reason:'arbitrary private error'},{pageSize:49},{readFinishedAt:'invalid'},{sourceAttempted:false},{sourceAttempt:{...valid.sourceAttempt,httpStatus:999}},{cooldownOrigin:{sql:'private'}}])assert.equal(copyAjesSourceReadReceipt({...valid,...patch}),undefined);
 const hostile=Object.defineProperty({},'version',{get(){throw Error('private getter');}});
 assert.equal(copyAjesSourceReadReceipt(hostile),undefined);assert.equal(ajesSourceReadReceiptFromError(Object.defineProperty({},'sourceReadReceipt',{get(){throw Error('private getter');}})),undefined);
});

test('non-2xx evidence keeps only observed finite markers and exact allowlisted identifiers',async()=>{
 const secret='private-password-fixture';
 const cases:[string,string,string|undefined][]=[
  [`bot2 ${secret}`,'bot_refusal',undefined],
  [`ban7 ${secret}`,'ban_refusal',undefined],
  [`Unknown column 'GRADE' in 'where clause' ${secret}`,'sql_unknown_column','grade'],
  ["Unknown column 'PW' in 'where clause'",'sql_unknown_column','pw'],
  [`Unknown column '${secret}' in 'where clause'`,'sql_unknown_column',undefined],
  ["Unknown column 'stats.grade' in 'where clause'",'sql_unknown_column',undefined],
  ["Unknown column 'grade' in 'where clause'; Unknown column 'pw' in 'field list'",'sql_unknown_column',undefined],
  [`Unknown column 'grade' in 'where clause'; Unknown column '${secret}' in 'field list'`,'sql_unknown_column',undefined],
  [`SQLSTATE[42000]: Syntax error or access violation: 1064 ${secret}`,'sql_syntax',undefined],
  [`FUNCTION concat_ws does not exist ${secret}`,'sql_unsupported_function','concat_ws'],
  ['no such function: trim','sql_unsupported_function','trim'],
  [`Unknown function '${secret}'`,'sql_unsupported_function',undefined],
  [`FUNCTION concat_ws does not exist; Unknown function '${secret}'`,'sql_unsupported_function',undefined],
  [`{"error":"${secret}"}`,'json_unclassified',undefined],
  [`<html><body>${secret}</body></html>`,'html_unclassified',undefined],
  [secret,'text_unclassified',undefined],
 ];
 for(const [body,bodyClass,identifier] of cases){
  let fetches=0,reserves=0;const client=createAjesClient({...base,reserve:async()=>{reserves++;},fetcher:async()=>{fetches++;return new Response(body,{status:500,headers:{'content-type':'text/plain; charset='+secret,'content-encoding':'identity'}});}});
  let failure:unknown;try{await client.read(query,ip);}catch(error){failure=error;}
  assert.ok(failure instanceof AjesUnavailable);assert.equal(failure.reason,'http_500');
  const source=ajesSourceReadReceiptFromError(failure)!;assert.ok(source);assert.equal(source.sourceAttempted,true);assert.equal(source.reason,'http_500');
  const observed=source.sourceAttempt?.responseEvidence;assert.ok(observed);
  assert.deepEqual(observed,{version:1,mime:'text',encoding:'identity',bodyClass,bytesRead:Buffer.byteLength(body),truncated:false,readStatus:'complete',...(identifier?{identifier}:{})});
  const raw=JSON.stringify(source);for(const privateValue of [secret,ip,'http://','select ','where clause','SQLSTATE'])assert.equal(raw.includes(privateValue),false,privateValue);
  assert.equal(fetches,1);assert.equal(reserves,1);
 }
});

test('HTTP 500 with a refusal marker preserves exact-query cooldown, stale recovery and all source counts',async()=>{
 let fetches=0,reserves=0;const diagnostics:any[]=[],persisted:any[]=[];
 const saved=snapshot(),client=createAjesClient({...base,readQuery:async()=>saved,reserve:async()=>{reserves++;},
  saveQuery:async(_sql,value)=>{persisted.push(value);},saveRequestFailure:async value=>{diagnostics.push(value);},
  fetcher:async()=>{fetches++;return new Response('bot2 private-password-fixture',{status:500});}});
 const first=await client.read(query,ip),a=receipt(first);
 assert.equal(first.stale,true);assert.deepEqual(first.items,saved.items);assert.equal(first.observedAt,saved.observedAt);
 assert.equal(a.reason,'http_500');assert.equal(a.disposition,'source_recovery');assert.equal(a.sourceAttempt?.responseEvidence?.bodyClass,'bot_refusal');
 const second=receipt(await client.read(query,ip));assert.equal(second.reason,'http_500');assert.equal(second.sourceAttempt,null);
 assert.equal(second.disposition,'cooldown_recovery');assert.equal((second.cooldownOrigin as any)?.responseEvidence,undefined);
 await assert.rejects(client.read({...query,page:2},ip),/http_500/);assert.equal(fetches,2,'HTTP500 remains query-local, not a visitor-wide bot cooldown');assert.equal(reserves,2);
 await tick();assert.equal(persisted.length,0);assert.ok(diagnostics.length);
 for(const value of diagnostics){assert.equal(value.providerCode,null);assert.equal(value.outcome,'http_500');assert.equal(JSON.stringify(value).includes('private-password-fixture'),false);assert.equal(Object.hasOwn(value,'responseEvidence'),false);}
});

test('large error chunks retain only 4096 prefix bytes and cancel without waiting for cleanup',async()=>{
 let cancelCalls=0,pulls=0;
 const stream=new ReadableStream<Uint8Array>({pull(controller){pulls++;controller.enqueue(Buffer.from('x'.repeat(4096)+"Unknown column 'grade' private-password-fixture"));},cancel(){cancelCalls++;return new Promise<void>(()=>{});}});
 const response=new Response(stream,{status:500,headers:{'content-type':'text/plain'}}),control=new AbortController();
 const observed=await readAjesNon2xxResponseEvidence(response,control.signal);
 assert.deepEqual(observed,{version:1,mime:'text',encoding:'missing',bodyClass:'text_unclassified',bytesRead:4096,truncated:true,readStatus:'limit'});
 assert.equal(cancelCalls,1);assert.ok(pulls<=2,'one consumed chunk plus the native stream queue at most');assert.equal(stream.locked,false);
 assert.equal(getEventListeners(control.signal,'abort').length,0);
 const marker=new Response(new ReadableStream({start(controller){controller.enqueue(Buffer.from("Unknown column 'grade' "+'x'.repeat(4096)));},cancel(){}}),{status:500});
 const truncated=await readAjesNon2xxResponseEvidence(marker,new AbortController().signal);
 assert.equal(truncated?.bodyClass,'sql_unknown_column');assert.equal(truncated?.identifier,undefined,'an incomplete prefix never certifies an identifier');
});

test('a stalled error body and a stalled cancel remain within the one observation timeout',async t=>{
 const set=globalThis.setTimeout,delays:number[]=[];
 t.mock.method(globalThis,'setTimeout',((callback:any,delay?:number,...args:any[])=>{delays.push(Number(delay));return set(callback,delay,...args);}) as typeof setTimeout);
 let cancelled=0;const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(Buffer.from('prefix'));},cancel(){cancelled++;return new Promise<void>(()=>{});}});
 const control=new AbortController(),started=performance.now();
 const observed=await readAjesNon2xxResponseEvidence(new Response(stream,{status:500}),control.signal);
 assert.equal(observed?.readStatus,'timeout');assert.equal(observed?.truncated,true);assert.equal(observed?.bytesRead,6);
 assert.equal(cancelled,1);assert.equal(stream.locked,false);assert.equal(getEventListeners(control.signal,'abort').length,0);
 assert.equal(delays.length,1);assert.ok(delays[0]>=0&&delays[0]<=250);assert.ok(performance.now()-started<1500,'a never-settling cancel is not awaited');
});

test('endless immediately available empty chunks cannot starve the diagnostic deadline',async()=>{
 let pulls=0,cancelled=0;
 const stream=new ReadableStream<Uint8Array>({pull(controller){pulls++;controller.enqueue(new Uint8Array());},cancel(){cancelled++;}});
 const control=new AbortController(),started=performance.now(),observed=await readAjesNon2xxResponseEvidence(new Response(stream,{status:500}),control.signal);
 assert.ok(observed&&['chunk_limit','timeout'].includes(observed.readStatus));assert.equal(observed.bytesRead,0);assert.equal(observed.truncated,true);
 assert.ok(pulls<=4097);assert.equal(cancelled,1);assert.equal(stream.locked,false);assert.equal(getEventListeners(control.signal,'abort').length,0);
 assert.ok(performance.now()-started<1500);
});

test('the original monotonic deadline also bounds a hot stream before its abort event is delivered',async()=>{
 let cancelled=0,pulls=0;const control=new AbortController();
 const stream=new ReadableStream<Uint8Array>({pull(controller){pulls++;controller.enqueue(new Uint8Array());},cancel(){cancelled++;return new Promise<void>(()=>{});}});
 const originalDeadline=performance.now()+3;
 const value=await readAjesNon2xxResponseEvidence(new Response(stream,{status:500}),control.signal,originalDeadline);
 assert.equal(control.signal.aborted,false,'the deadline does not depend on a timer delivering an abort event');
 assert.equal(value?.readStatus,'aborted');assert.equal(value?.truncated,true);assert.equal(value?.bytesRead,0);
 assert.equal(cancelled,1);assert.ok(pulls<=4097);assert.equal(stream.locked,false);assert.equal(getEventListeners(control.signal,'abort').length,0);
});

test('the original abort signal stops observation before or during a pending body read',async()=>{
 for(const already of [true,false]){
  const control=new AbortController();let cancelled=0,pulls=0;
  const stream=new ReadableStream<Uint8Array>({pull(){pulls++;},cancel(){cancelled++;return new Promise<void>(()=>{});}});
  if(already)control.abort();
  const observed=readAjesNon2xxResponseEvidence(new Response(stream,{status:500}),control.signal);
  if(!already)control.abort();
  const value=await observed;assert.equal(value?.readStatus,'aborted');assert.equal(value?.truncated,true);assert.equal(value?.bytesRead,0);
  assert.equal(cancelled,1);assert.ok(pulls<=1);assert.equal(stream.locked,false);assert.equal(getEventListeners(control.signal,'abort').length,0);
 }
});

test('stream and header errors remain observational and never replace the original HTTP failure',async()=>{
 for(const status of [400,500])for(const failureKind of ['body','headers']){
  let fetches=0,reserves=0;
  const stream=new ReadableStream<Uint8Array>({pull(controller){controller.error(Error('private-password-fixture'));}});
  const response=new Response(stream,{status});
  if(failureKind==='headers')Object.defineProperty(response,'headers',{get(){throw Error('private-password-fixture');}});
  const client=createAjesClient({...base,reserve:async()=>{reserves++;},fetcher:async()=>{fetches++;return response;}});
  let failure:unknown;try{await client.read(query,ip);}catch(error){failure=error;}
  assert.ok(failure instanceof AjesUnavailable);assert.equal(failure.reason,`http_${status}`);
  const read=ajesSourceReadReceiptFromError(failure)!;assert.ok(read);assert.equal(read.sourceAttempt?.httpStatus,status);
  assert.equal(read.sourceAttempt?.responseEvidence?.readStatus,'read_error');assert.equal(JSON.stringify(read).includes('private-password-fixture'),false);
  assert.equal(fetches,1);assert.equal(reserves,1);assert.equal(stream.locked,false);
 }
});

test('response evidence handles absent and binary bodies without inventing a textual reason',async()=>{
 const noBody=await readAjesNon2xxResponseEvidence(new Response(null,{status:500}),new AbortController().signal);
 assert.deepEqual(noBody,{version:1,mime:'missing',encoding:'missing',bodyClass:'empty',bytesRead:0,truncated:false,readStatus:'no_body'});
 const binary=await readAjesNon2xxResponseEvidence(new Response(new Uint8Array([255,0,1]),{status:500,headers:{'content-type':'application/octet-stream','content-encoding':'br'}}),new AbortController().signal);
 assert.deepEqual(binary,{version:1,mime:'other',encoding:'other',bodyClass:'binary_unclassified',bytesRead:3,truncated:false,readStatus:'complete'});
});

test('nested response evidence rejects private extras, getters, wrong bindings and impossible bounds',async()=>{
 let failure:unknown;try{await createAjesClient({...base,fetcher:async()=>new Response("Unknown column 'grade' in 'where clause'",{status:500})}).read(query,ip);}catch(error){failure=error;}
 const valid=ajesSourceReadReceiptFromError(failure)!,observed=valid.sourceAttempt!.responseEvidence!;assert.ok(observed);
 for(const patch of [{body:'private-password-fixture'},{bodyHash:'a'.repeat(64)},{bytesRead:4097},{bytesRead:-1},{bytesRead:1.5},{readStatus:'limit'},
  {truncated:true},{readStatus:'timeout'},{readStatus:'chunk_limit'},{identifier:'private-password-fixture'},{identifier:'concat_ws'},{bodyClass:'sql_syntax'},
  {readStatus:'limit',bytesRead:4096,truncated:true},
  {mime:'text/private-password-fixture'},{encoding:'private-password-fixture'},{version:2}]){
  assert.equal(copyAjesResponseEvidence({...observed,...patch}),undefined);
 }
 assert.equal(copyAjesResponseEvidence(null),undefined);assert.equal(copyAjesResponseEvidence({...observed,identifier:undefined})?.identifier,undefined);
 for(const httpStatus of [null,200,204,299])assert.equal(copyAjesSourceReadReceipt({...valid,sourceAttempt:{...valid.sourceAttempt,httpStatus}}),undefined);
 assert.equal(copyAjesSourceReadReceipt({...valid,sourceAttempt:{...valid.sourceAttempt,responseEvidence:null}}),undefined);
 let getterCalls=0;const hostile={...observed};Object.defineProperty(hostile,'mime',{enumerable:true,get(){getterCalls++;return getterCalls===1?'text':'private-password-fixture';}});
 assert.equal(copyAjesResponseEvidence(hostile),undefined);assert.equal(getterCalls,0);
 Object.defineProperty(hostile,'mime',{enumerable:true,configurable:true,get(){throw Error('private-password-fixture');}});
 assert.equal(copyAjesResponseEvidence(hostile),undefined);
});
