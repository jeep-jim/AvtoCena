import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createAjesClient,AjesUnavailable} from '../apps/web/lib/catalog/ajes-client';
import {ajesErrorResponse} from '../apps/web/lib/catalog/ajes-error-response';
import {ajesQuery} from '../apps/web/lib/catalog/ajes-query';
import {inspectAjesHttpFailureResponse,sanitizeAjesResponseValidation,saveAjesRequestFailure,type AjesRequestDiagnostic,type AjesHttpBodyDiagnostic} from '../apps/web/lib/catalog/ajes-request-diagnostic';

const flags=['gzip','sqlSyntax','unknownColumn','unsupportedQuery','accessRefusal','credentialError','shortBotOrBan'] as const;
const base={password:()=> 'private-password',assertEnabled:async()=>{},reserve:async()=>{},endpoint:()=> 'https://private-provider.invalid/api/'};
const query={table:'stats' as const,page:1,pageSize:24};
const privateText='body-secret-984 https://body-secret.invalid/203.0.113.9?id=private-row-id';
const safe=(value:unknown)=>assert.doesNotMatch(JSON.stringify(value),/body-secret|private-row-id|private-password|private-provider|203\.0\.113|select |"sql"|"endpoint"|"clientIp"/);
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function inspect(response:Response,signal=new AbortController().signal,deadlineAt=Date.now()+20_000){
 const result=await inspectAjesHttpFailureResponse(response,signal,deadlineAt);
 assert.deepEqual(sanitizeAjesResponseValidation(result),result);safe(result);
 return result.httpBody!;
}

test('non-2xx body evidence contains finite literal markers, never matched text or a claimed exclusive cause',async()=>{
 const cases:Array<[string,(typeof flags[number])[]]>=[
  [`You have an error in your SQL syntax; ${privateText}`,['sqlSyntax']],
  [`<html>Unknown column '${privateText}' in where clause</html>`,['unknownColumn']],
  [`{"error":"Unsupported query: ${privateText}"}`,['unsupportedQuery']],
  [`This version does not yet support this statement; ${privateText}`,['unsupportedQuery']],
  [`Access denied; ${privateText}`,['accessRefusal']],
  [`Invalid API key; ${privateText}`,['credentialError']],
  [`Access denied for user '${privateText}'`,['accessRefusal','credentialError']],
  [`bot7 private-password ${privateText}`,['accessRefusal','shortBotOrBan']],
  [`ban2 ${privateText}`,['accessRefusal','shortBotOrBan']],
  [`Upstream server unavailable; ${privateText}`,[]],
  ['Syntax error in an unrelated template',[]],
  ['robotics catalog; banquet',[]],
 ];
 for(const [body,matched] of cases){
  const value=await inspect(new Response(body,{status:500}));
  assert.equal(value.stop,'complete');assert.equal(value.truncated,false);assert.equal(value.inspectedBytes,Buffer.byteLength(body));
  assert.deepEqual(flags.filter(flag=>value[flag]),matched);
 }
});

test('empty and gzip error bodies remain bounded facts; compressed content is never expanded for diagnosis',async()=>{
 const empty=await inspect(new Response(null,{status:500}));
 assert.equal(empty.stop,'no_body');assert.equal(empty.inspectedBytes,0);assert.equal(empty.truncated,false);assert(flags.every(flag=>!empty[flag]));
 const zero=await inspect(new Response('',{status:500}));assert.equal(zero.stop,'complete');assert.equal(zero.inspectedBytes,0);
 const compressed=gzipSync(`You have an error in your SQL syntax; ${privateText}`.repeat(1000));
 assert(compressed.length<4096);
 const zipped=await inspect(new Response(compressed,{status:500}));
 assert.equal(zipped.gzip,true);assert.equal(zipped.inspectedBytes,compressed.length);assert.equal(zipped.stop,'complete');
 assert(flags.filter(flag=>flag!=='gzip').every(flag=>!zipped[flag]));
});

test('an oversized transport chunk inspects only the first 4 KiB and cancels without awaiting cancellation',async()=>{
 let cancelled=0,pulls=0;
 const chunk=Buffer.from('x'.repeat(4096)+`Unknown column '${privateText}'`.repeat(1000));
 const stream=new ReadableStream<Uint8Array>({pull(controller){pulls++;controller.enqueue(chunk);},cancel(){cancelled++;return new Promise(()=>{});}},{highWaterMark:0});
 const started=Date.now(),value=await inspect(new Response(stream,{status:500}));
 assert.equal(value.inspectedBytes,4096);assert.equal(value.stop,'byte_limit');assert.equal(value.truncated,true);
 assert(flags.every(flag=>!value[flag]));assert.equal(pulls,1);assert.equal(cancelled,1);assert(Date.now()-started<1000);
});

test('empty-chunk streams stop at 32 reads, without waiting for a timer or fetching again',async()=>{
 let pulls=0,cancelled=0;
 const stream=new ReadableStream<Uint8Array>({pull(controller){pulls++;controller.enqueue(new Uint8Array());},cancel(){cancelled++;}},{highWaterMark:0});
 const value=await inspect(new Response(stream,{status:500}));
 assert.equal(value.stop,'read_limit');assert.equal(value.inspectedBytes,0);assert.equal(value.truncated,true);
 assert.equal(pulls,32);assert.equal(cancelled,1);
});

test('a stalled body respects its short observation budget and does not classify an incomplete bot prefix as short',async()=>{
 let cancelled=0;
 const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(Buffer.from('bot7 private-password'));},cancel(){cancelled++;return new Promise(()=>{});}});
 const started=Date.now(),value=await inspect(new Response(stream,{status:500}));
 assert.equal(value.stop,'time_limit');assert.equal(value.truncated,true);assert.equal(value.shortBotOrBan,false);
 assert.equal(cancelled,1);assert(Date.now()-started<1000,'stalled cancellation must not extend the observation');
});

test('existing request deadline and abort take precedence over the short body observation budget',async()=>{
 for(const mode of ['elapsed','deadline','abort'] as const){
  let cancelled=0,pulls=0;const controller=new AbortController();
  const stream=new ReadableStream<Uint8Array>({pull(){pulls++;return new Promise(()=>{});},cancel(){cancelled++;}},{highWaterMark:0});
  const started=Date.now();let abortTimer:ReturnType<typeof setTimeout>|undefined;
  if(mode==='abort')abortTimer=setTimeout(()=>controller.abort(),10);
  const value=await inspect(new Response(stream,{status:500}),controller.signal,mode==='elapsed'?started-1:mode==='deadline'?started+15:started+20_000);
  if(abortTimer)clearTimeout(abortTimer);
  assert.equal(value.stop,'deadline');assert.equal(value.truncated,true);assert.equal(cancelled,1);assert(Date.now()-started<500);
  if(mode==='elapsed')assert.equal(pulls,0);
 }
});

test('stream errors preserve only finite read_error evidence',async()=>{
 const stream=new ReadableStream<Uint8Array>({pull(){throw Error(privateText);}},{highWaterMark:0});
 const value=await inspect(new Response(stream,{status:500}));
 assert.equal(value.stop,'read_error');assert.equal(value.inspectedBytes,0);assert.equal(value.truncated,true);assert(flags.every(flag=>!value[flag]));
});

test('client preserves each original HTTP reason, visitor, query, single reservation and public receipt while saving only sanitized body facts',async()=>{
 const cases:Array<[number,string,string,(typeof flags[number])[]]>=[
  [500,`Unknown column '${privateText}'`,'http_500',['unknownColumn']],
  [500,`bot7 private-password ${privateText}`,'http_500',['accessRefusal','shortBotOrBan']],
  [414,`Unsupported query ${privateText}`,'query_too_large',['unsupportedQuery']],
  [403,`Forbidden ${privateText}`,'http_403',['accessRefusal']],
  [401,`Invalid API key ${privateText}`,'http_401',['credentialError']],
  [429,`quota exhausted ${privateText}`,'http_429',[]],
 ];
 for(const [status,body,reason,matched] of cases){
  const records:AjesRequestDiagnostic[]=[],requests:URL[]=[];let reservations=0,cacheWrites=0;
  const client=createAjesClient({...base,reserve:async()=>{reservations++;},saveQuery:async()=>{cacheWrites++;},
   saveRequestFailure:value=>saveAjesRequestFailure({writeJson:async(_key,record)=>{records.push(structuredClone(record));}},value),
   fetcher:async input=>{requests.push(new URL(String(input)));return new Response(body,{status});}});
  let thrown:unknown;try{await client.read(query,'203.0.113.1');}catch(error){thrown=error;}
  assert(thrown instanceof AjesUnavailable);assert.equal(thrown.reason,reason);await tick();
  assert.equal(requests.length,1);assert.equal(reservations,1);assert.equal(cacheWrites,0);
  assert.equal(requests[0].searchParams.get('ip'),'203.0.113.1');assert.equal(requests[0].searchParams.get('sql'),ajesQuery(query).sql);
  assert.equal(records.length,2);
  for(const record of records){
   assert.equal(record.httpStatus,status);assert.equal(record.outcome,reason);assert.equal(record.providerCode,null);
   assert.deepEqual(flags.filter(flag=>record.responseValidation?.httpBody?.[flag]),matched);safe(record.responseValidation);
   assert.doesNotMatch(JSON.stringify(record),/body-secret|private-row-id|private-password/);
  }
  const publicFailure=ajesErrorResponse(thrown);safe(publicFailure);
  assert.equal(publicFailure.body.reason,reason);assert.equal(publicFailure.body.sourceReceipt?.supplierAttempted,true);
  assert.equal(publicFailure.body.sourceReceipt?.outcome,'unavailable');assert.doesNotMatch(JSON.stringify(publicFailure),/responseValidation|httpBody|shortBotOrBan/);
 }
});

test('stalled non-2xx diagnosis cannot replace http_500 with a timeout or delay recovery indefinitely',async()=>{
 let cancelled=0,calls=0;const records:AjesRequestDiagnostic[]=[];
 const client=createAjesClient({...base,saveRequestFailure:async value=>{records.push(value);},fetcher:async()=>{
  calls++;return new Response(new ReadableStream({cancel(){cancelled++;return new Promise(()=>{});}}),{status:500});
 }});
 const started=Date.now();
 await assert.rejects(client.read(query,'203.0.113.1'),error=>error instanceof AjesUnavailable&&error.reason==='http_500');await tick();
 assert(Date.now()-started<1500);assert.equal(calls,1);assert.equal(cancelled,1);
 assert.equal(records[0].outcome,'http_500');assert.equal(records[0].responseValidation?.httpBody?.stop,'time_limit');
});

test('stale recovery, its cooldown and successful responses keep their established behavior',async()=>{
 const observedAt=new Date(Date.now()-3600_000).toISOString();
 const saved={schemaVersion:2,items:[{id:'old',table:'stats'}],page:1,pageSize:24,received:24,rejected:0,observedAt,partial:true};
 const records:AjesRequestDiagnostic[]=[];let calls=0,writes=0;
 const client=createAjesClient({...base,readQuery:async()=>saved,saveQuery:async()=>{writes++;},saveRequestFailure:async value=>{records.push(value);},
  fetcher:async()=>{calls++;return new Response(`Unknown column '${privateText}'`,{status:503});}});
 const failed=await client.read(query,'203.0.113.1'),cooldown=await client.read(query,'203.0.113.1');await tick();
 for(const value of [failed,cooldown]){
  assert.equal(value.stale,true);assert.equal(value.partial,true);assert.equal(value.observedAt,observedAt);assert.equal(value.sourceReceipt.reason,'http_503');
  assert.equal(value.sourceReceipt.outcome,'stale');assert.equal(value.responseValidation,undefined);assert.equal(value.sourceReceipt.responseValidation,undefined);safe(value.sourceReceipt);
 }
 assert.equal(failed.sourceReceipt.supplierAttempted,true);assert.equal(cooldown.sourceReceipt.supplierAttempted,false);assert.equal(cooldown.sourceReceipt.stage,'cooldown');
 assert.equal(calls,1);assert.equal(writes,0);assert.equal(records.length,1);
 const freshRecords:AjesRequestDiagnostic[]=[];
 const fresh=createAjesClient({...base,saveRequestFailure:async value=>{freshRecords.push(value);},fetcher:async()=>Response.json([{ID:'ok',MARKA_NAME:'TOYOTA',MODEL_NAME:'AQUA',YEAR:'2021',AUCTION_TYPE:'2',STATUS:'Sold',FINISH:'100000',PW:'74',KPP:'AT',TIME:'P',RATE:'5'}])});
 const result=await fresh.read(query,'203.0.113.2');assert.equal(result.stale,false);assert.equal(result.items.length,1);assert.equal(result.sourceReceipt.outcome,'fresh');assert.equal(freshRecords.length,0);
 const botRecords:AjesRequestDiagnostic[]=[];
 const bot=createAjesClient({...base,saveRequestFailure:async value=>{botRecords.push(value);},fetcher:async()=>new Response('bot7 private-password')});
 await assert.rejects(bot.read(query,'203.0.113.3'),/visitor_restricted/);await tick();
 assert.equal(botRecords[0].providerCode,'bot7');assert.equal(botRecords[0].httpStatus,200);assert.equal(botRecords[0].responseValidation,undefined);
});

test('HTTP body schema rejects raw text, malformed fields, inconsistent limits and getters without reading them',async()=>{
 const valid=await inspectAjesHttpFailureResponse(new Response('Unknown column private-field',{status:500}),new AbortController().signal,Date.now()+1000);
 const body=valid.httpBody!;
 const cases:any[]=[{...valid,version:2},{...valid,wireBytes:3},{...valid,originCode:'http_500'},{...valid,phase:'decode'},
  ...[{inspectedBytes:-1},{inspectedBytes:4097},{inspectedBytes:NaN},{inspectedBytes:'1'},{inspectedBytes:0},{truncated:true},{stop:'private body'},
   {stop:'byte_limit',truncated:true},{stop:'no_body'},{unknownColumn:'true'},{sqlSyntax:undefined},{body:privateText},{gzip:true},
   {shortBotOrBan:true},{stop:'time_limit',truncated:true,shortBotOrBan:true,accessRefusal:true}].map(change=>({...valid,httpBody:{...body,...change}}))];
 for(const value of cases)assert.equal(sanitizeAjesResponseValidation(value),undefined);
 let touched=false;
 assert.equal(sanitizeAjesResponseValidation({...valid,httpBody:{...body,get sqlSyntax(){touched=true;throw Error(privateText);}}}),undefined);assert.equal(touched,false);
 assert.equal(sanitizeAjesResponseValidation({...valid,httpBody:Object.create(body)}),undefined);
 assert.equal(sanitizeAjesResponseValidation({...valid,httpBody:{...body,[Symbol('secret')]:privateText}}),undefined);
 const nullPrototype=Object.assign(Object.create(null),body);assert.deepEqual(sanitizeAjesResponseValidation({...valid,httpBody:nullPrototype}),valid);
 const shortBody:AjesHttpBodyDiagnostic={...body,inspectedBytes:257,unknownColumn:false,shortBotOrBan:true,accessRefusal:true};
 assert.equal(sanitizeAjesResponseValidation({...valid,httpBody:shortBody}),undefined);
});

test('persisted HTTP diagnostics bind to the original non-2xx status/outcome and strip an invalid optional block',async()=>{
 const validation=await inspectAjesHttpFailureResponse(new Response('SQL syntax error',{status:500}),new AbortController().signal,Date.now()+1000);
 const original:AjesRequestDiagnostic={table:'stats',kind:'list',page:1,pageSize:24,startedAt:'2026-11-28T00:00:00.000Z',finishedAt:'2026-11-28T00:00:01.000Z',
  clientIp:'203.0.113.1',sql:'select * from stats limit 0,24',endpoint:'https://private-provider.invalid/api/',httpStatus:500,providerCode:null,outcome:'http_500'};
 const writes:AjesRequestDiagnostic[]=[];const storage={writeJson:async(_key:string,value:AjesRequestDiagnostic)=>{writes.push(value);}};
 for(const [httpStatus,outcome,keep] of [[500,'http_500',true],[414,'query_too_large',true],[300,'http_300',true],[599,'http_599',true],
  [200,'http_500',false],[600,'http_600',false],[500,'request_timeout',false],[414,'http_414',false],[null,'http_500',false]] as const){
  await saveAjesRequestFailure(storage,{...original,httpStatus,outcome,responseValidation:validation});
  assert.deepEqual(writes.at(-1)?.responseValidation,keep?validation:undefined);
 }
 await saveAjesRequestFailure(storage,{...original,responseValidation:{...validation,httpBody:{...validation.httpBody!,body:privateText}} as any});
 assert.deepEqual(writes.at(-1),original);assert.doesNotMatch(JSON.stringify(writes),/body-secret|private-row-id/);
});
