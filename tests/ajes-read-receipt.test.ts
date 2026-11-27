import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAjesClient,AjesUnavailable} from '../apps/web/lib/catalog/ajes-client';
import {ajesQuery} from '../apps/web/lib/catalog/ajes-query';
import {ajesErrorResponse} from '../apps/web/lib/catalog/ajes-error-response';
import {publicAjesReadReceipt} from '../apps/web/lib/catalog/ajes-read-receipt';
import {sanitizeAjesResponseValidation,saveAjesRequestFailure,type AjesRequestDiagnostic} from '../apps/web/lib/catalog/ajes-request-diagnostic';

const row={ID:'receipt1',MARKA_NAME:'TOYOTA',MODEL_NAME:'AQUA',YEAR:'2021',AUCTION_TYPE:'2',STATUS:'Sold',FINISH:'100000',PW:'74',KPP:'AT',TIME:'P',RATE:'5'};
const base={password:()=> 'private-password',assertEnabled:async()=>{},reserve:async()=>{},endpoint:()=> 'https://private-provider.invalid/api/'};
const query={table:'stats' as const,auctionGrade:'5',transmission:'automatic',fuel:'petrol',powerTo:160};
const queryHash=createHash('sha256').update(ajesQuery(query).sql).digest('hex');
const safe=(value:any)=>assert.doesNotMatch(JSON.stringify(value),/private-password|private-provider|private body|203\.0\.113|select |marka_name|clientIp|endpoint|"sql"/);

test('fresh supplier and cache reads have separate bounded receipts without persisting request metadata',async()=>{
 const writes:any[]=[],ips:string[]=[];
 const client=createAjesClient({...base,saveQuery:async(_sql,value)=>{writes.push(structuredClone(value));},fetcher:async url=>{ips.push(new URL(String(url)).searchParams.get('ip')!);return Response.json([row]);}});
 const fresh=await client.read(query,'203.0.113.1'),cached=await client.read(query,'203.0.113.2');
 assert.equal(fresh.sourceReceipt.queryHash,queryHash);assert.equal(fresh.sourceReceipt.supplierAttempted,true);assert.equal(fresh.sourceReceipt.outcome,'fresh');
 assert.equal(cached.sourceReceipt.supplierAttempted,false);assert.equal(cached.sourceReceipt.outcome,'fresh');assert.notEqual(cached.sourceReceipt.requestId,fresh.sourceReceipt.requestId);
 assert.equal(cached.observedAt,fresh.observedAt);assert.equal(cached.sourceReceipt.observedAt,fresh.observedAt);assert.deepEqual(ips,['203.0.113.1']);
 await new Promise(resolve=>setTimeout(resolve,0));assert.equal(writes.length,1);assert.equal('sourceReceipt' in writes[0],false);
 assert.deepEqual(publicAjesReadReceipt(fresh.sourceReceipt),fresh.sourceReceipt);safe(fresh.sourceReceipt);safe(cached.sourceReceipt);
});

test('stale recovery identifies this failure and cooldown without refreshing the old observation',async()=>{
 const observedAt=new Date(Date.now()-3600000).toISOString();let attempts=0;
 const saved={schemaVersion:2,items:[{id:'old',table:'stats'}],page:1,pageSize:24,received:24,rejected:0,observedAt};
 const client=createAjesClient({...base,readQuery:async()=>saved,fetcher:async()=>{attempts++;return new Response('private body',{status:503});}});
 const failed=await client.read(query,'203.0.113.1'),cooldown=await client.read(query,'203.0.113.1');
 assert.equal(failed.sourceReceipt.queryHash,queryHash);assert.equal(failed.sourceReceipt.reason,'http_503');assert.equal(failed.sourceReceipt.outcome,'stale');assert.equal(failed.sourceReceipt.supplierAttempted,true);
 assert.equal(cooldown.sourceReceipt.stage,'cooldown');assert.equal(cooldown.sourceReceipt.reason,'http_503');assert.equal(cooldown.sourceReceipt.supplierAttempted,false);assert.equal(attempts,1);
 assert.equal(failed.observedAt,observedAt);assert.equal(cooldown.sourceReceipt.observedAt,observedAt);assert.equal('sourceReceipt' in saved,false);safe(failed.sourceReceipt);safe(cooldown.sourceReceipt);
});

test('public failures expose the exact safe reason and request hash without source text',async()=>{
 const client=createAjesClient({...base,fetcher:async()=>new Response('private body',{status:500})});
 let failed:unknown;try{await client.read(query,'203.0.113.1');}catch(error){failed=error;}
 const result=ajesErrorResponse(failed);
 assert.equal(result.status,503);assert.equal(result.body.reason,'http_500');assert.equal(result.body.sourceReceipt?.queryHash,queryHash);assert.equal(result.body.sourceReceipt?.outcome,'unavailable');assert.equal(result.body.sourceReceipt?.supplierAttempted,true);safe(result);
 const injected={...result.body.sourceReceipt,sql:'private body',clientIp:'203.0.113.1',endpoint:'private-provider',reason:'private-password'};
 const sanitized=publicAjesReadReceipt(injected);assert.equal(sanitized?.reason,'operation_failed');safe(sanitized);
 assert.equal(publicAjesReadReceipt({...injected,queryHash:'private body'}),undefined);
 for(const reason of ['empty_response','directory_unavailable','local_busy','query_too_large','http_429'])assert.equal(ajesErrorResponse(new AjesUnavailable(reason)).body.reason,reason);
 assert.equal(ajesErrorResponse(new AjesUnavailable('private-password')).body.reason,'operation_failed');
});

test('real IP and owner restrictions remain enforced before supplier access',async()=>{
 let calls=0;const denied=Error('owner source disabled');
 const client=createAjesClient({...base,fetcher:async()=>{calls++;return Response.json([row]);}});
 await assert.rejects(client.read(query,''),error=>error instanceof AjesUnavailable&&error.reason==='client_ip_missing');assert.equal(calls,0);
 const disabled=createAjesClient({...base,assertEnabled:async()=>{throw denied;},fetcher:async()=>{calls++;return Response.json([row]);}});
 await assert.rejects(disabled.read(query,'203.0.113.1'),error=>error===denied);assert.equal(calls,0);
});

test('private invalid-response diagnostics distinguish JSON, row overflow and nested empty-page COUNT without changing recovery',async()=>{
 const observedAt=new Date(Date.now()-4*3600000).toISOString();
 const saved={schemaVersion:2,items:[{id:'old',table:'stats'}],page:3,pageSize:24,received:24,rejected:23,observedAt,partial:true};
 for(const kind of ['json','overflow','count'] as const){
  let attempts=0;const records:AjesRequestDiagnostic[]=[];
  const invalidJson='private body private-password 203.0.113.1 {not-json';
  const overflow=Array.from({length:25},()=>row);
  const client=createAjesClient({...base,readQuery:async sql=>sql.startsWith('select *')?saved:null,
   saveRequestFailure:async value=>{records.push(structuredClone(value));},fetcher:async url=>{
    attempts++;if(kind==='json')return new Response(invalidJson);
    if(kind==='overflow')return Response.json(overflow);
    const sql=new URL(String(url)).searchParams.get('sql')!;
    return Response.json(sql.startsWith('select count')?[{TAG0:'private body'}]:[]);
   }});
  const failed=await client.read({page:3},'203.0.113.1'),cooldown=await client.read({page:3},'203.0.113.1');
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(attempts,kind==='count'?2:1);assert.equal(failed.stale,true);assert.equal(failed.partial,true);
  assert.equal(failed.observedAt,observedAt);assert.equal(cooldown.observedAt,observedAt);
  assert.equal(failed.sourceReceipt.reason,'invalid_response');assert.equal(cooldown.sourceReceipt.reason,'invalid_response');
  assert.equal(cooldown.sourceReceipt.stage,'cooldown');assert.equal(cooldown.sourceReceipt.supplierAttempted,false);
  assert.equal('responseValidation' in failed,false);assert.equal('responseValidation' in failed.sourceReceipt,false);safe(failed.sourceReceipt);safe(cooldown.sourceReceipt);
  const record=records.find(value=>value.kind==='list'&&value.page===3)!;
  assert.equal(record.httpStatus,200);assert.equal(record.outcome,'invalid_response');
  if(kind==='json')assert.deepEqual(record.responseValidation,{version:1,phase:'decode',code:'json_invalid',wireBytes:Buffer.byteLength(invalidJson),decodedBytes:Buffer.byteLength(invalidJson)});
  if(kind==='overflow')assert.deepEqual(record.responseValidation,{version:1,phase:'page_shape',code:'row_limit_exceeded',
   wireBytes:Buffer.byteLength(JSON.stringify(overflow)),decodedBytes:Buffer.byteLength(JSON.stringify(overflow)),rootKind:'array',rowCount:25});
  if(kind==='count'){
   assert.equal(failed.sourceReceipt.stage,'empty_verification');
   assert.deepEqual(record.responseValidation,{version:1,phase:'empty_confirmation',code:'count_unavailable',wireBytes:2,decodedBytes:2,rootKind:'array',rowCount:0,originCode:'invalid_response'});
   const origin=records.find(value=>value.kind==='count')!;
   assert.equal(origin.responseValidation?.phase,'aggregate_shape');assert.equal(origin.responseValidation?.code,'total_invalid');
  }
  safe(record.responseValidation);assert.deepEqual(sanitizeAjesResponseValidation(record.responseValidation),record.responseValidation);
 }
});

test('private validation metadata separates bounded gzip/root/row/aggregate failures and does not expose provider text',async()=>{
 const cases:Array<{query:any;body:BodyInit;phase:string;code:string}>=[
  {query:{page:3},body:Buffer.from([0x1f,0x8b,0,0,0]),phase:'decode',code:'gzip_invalid'},
  {query:{page:3},body:JSON.stringify({private:'private body'}),phase:'page_shape',code:'root_not_array'},
  {query:{page:3},body:'[null]',phase:'page_shape',code:'row_not_object'},
  {query:{aggregate:'count'},body:'[]',phase:'aggregate_shape',code:'count_row_count'},
  {query:{aggregate:'makes'},body:JSON.stringify([{TAG1:1}]),phase:'aggregate_shape',code:'make_name_missing'},
 ];
 for(const fixture of cases){
  const records:AjesRequestDiagnostic[]=[];
  const client=createAjesClient({...base,saveRequestFailure:async value=>{records.push(value);},fetcher:async()=>new Response(fixture.body)});
  let thrown:unknown;try{await client.read(fixture.query,'203.0.113.1');}catch(error){thrown=error;}
  assert(thrown instanceof AjesUnavailable);assert.equal(thrown.reason,'invalid_response');
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(records[0].responseValidation?.phase,fixture.phase);assert.equal(records[0].responseValidation?.code,fixture.code);
  if(fixture.code==='gzip_invalid')assert.equal(records[0].responseValidation?.decodedBytes,undefined);
  safe(records[0].responseValidation);safe(ajesErrorResponse(thrown));
 }
});

test('empty confirmation distinguishes an unavailable COUNT from a completed count that cannot prove exhaustion',async()=>{
 const records:AjesRequestDiagnostic[]=[];let requests=0;
 const client=createAjesClient({...base,saveRequestFailure:async value=>{records.push(value);},fetcher:async url=>{
  requests++;return Response.json(new URL(String(url)).searchParams.get('sql')!.startsWith('select count')?[{TAG0:100}]:[]);
 }});
 await assert.rejects(client.read({page:3},'203.0.113.1'),error=>error instanceof AjesUnavailable&&error.reason==='empty_response');
 await new Promise(resolve=>setTimeout(resolve,0));assert.equal(requests,2);
 assert.deepEqual(records.find(value=>value.kind==='list')?.responseValidation,{version:1,phase:'empty_confirmation',code:'count_unverified',
  wireBytes:2,decodedBytes:2,rootKind:'array',rowCount:0,originCode:'empty_response'});
});

test('validation sanitizer rejects oversized counters, secrets, accessors and unknown schemas; legacy failure records remain intact',async()=>{
 const valid={version:1,phase:'page_shape',code:'row_limit_exceeded',wireBytes:100,decodedBytes:200,rootKind:'array',rowCount:25};
 assert.deepEqual(sanitizeAjesResponseValidation(valid),valid);
 const limit=2*1024*1024;
 assert.equal(sanitizeAjesResponseValidation({...valid,wireBytes:limit,decodedBytes:limit,rowCount:limit})?.wireBytes,limit);
 for(const field of ['wireBytes','decodedBytes','rowCount'])for(const number of [-1,limit+1,1.5,NaN,Infinity,'1',null])
  assert.equal(sanitizeAjesResponseValidation({...valid,[field]:number}),undefined);
 for(const changed of [{version:2},{phase:'private body'},{code:'private-password'},{phase:'decode'},{phase:['page_shape']},{code:['row_limit_exceeded']},
  {rootKind:'private body'},{sql:'select private'},{clientIp:'203.0.113.1'},{originCode:'http_500'},{rowCount:undefined}])
  assert.equal(sanitizeAjesResponseValidation({...valid,...changed}),undefined);
 const nested={version:1,phase:'empty_confirmation',code:'count_unavailable',originCode:'http_500'};
 assert.deepEqual(sanitizeAjesResponseValidation(nested),nested);
 for(const originCode of ['private body','http_200','http_5999',{},undefined])assert.equal(sanitizeAjesResponseValidation({...nested,originCode}),undefined);
 let read=false;assert.equal(sanitizeAjesResponseValidation({...valid,get decodedBytes(){read=true;throw Error('private body');}}),undefined);assert.equal(read,false);
 assert.equal(sanitizeAjesResponseValidation(Object.create(valid)),undefined);
 const legacy:AjesRequestDiagnostic={table:'stats',kind:'list',page:3,pageSize:24,startedAt:'2026-11-27T00:00:00.000Z',finishedAt:'2026-11-27T00:00:01.000Z',
  clientIp:'203.0.113.1',sql:'select * from stats limit 48,24',endpoint:'https://private-provider.invalid/api/',httpStatus:200,providerCode:null,outcome:'invalid_response'};
 const writes:any[]=[];const storage={writeJson:async(key:string,value:any)=>{writes.push({key,value});}};
 await saveAjesRequestFailure(storage,legacy);assert.equal(writes.length,2);assert.deepEqual(writes[0].value,legacy);
 assert.equal(writes[1].key,'integrations/ajes/catalog-failure-pages/stats-list-3.json');
 await saveAjesRequestFailure(storage,{...legacy,responseValidation:{...valid,body:'private body'} as any});assert.deepEqual(writes[2].value,legacy);
});
