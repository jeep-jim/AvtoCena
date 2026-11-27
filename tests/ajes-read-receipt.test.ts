import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAjesClient,AjesUnavailable} from '../apps/web/lib/catalog/ajes-client';
import {ajesQuery} from '../apps/web/lib/catalog/ajes-query';
import {ajesErrorResponse} from '../apps/web/lib/catalog/ajes-error-response';
import {publicAjesReadReceipt} from '../apps/web/lib/catalog/ajes-read-receipt';

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
