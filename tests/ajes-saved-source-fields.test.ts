import test from 'node:test';
import assert from 'node:assert/strict';
import {createAjesClient,AjesUnavailable} from '../apps/web/lib/catalog/ajes-client';
import {ajesQuery,ajesSourceCacheSql} from '../apps/web/lib/catalog/ajes-query';
import {checksum,compileModelFacts,type CalculationIndex} from '../apps/web/lib/encyclopedia/calculation-index';

const source={ID:'field-fixture',MARKA_NAME:'TOYOTA',MODEL_NAME:'TEST',YEAR:2023,AUCTION_TYPE:2,STATUS:'Sold',FINISH:935000,BODY_TYPE:'SUV'};
function saved(observedAt=new Date().toISOString(),patch:Record<string,unknown>={}){
 return {schemaVersion:2,items:[{id:'field-fixture',table:'stats'}],sourceFields:['ID','BODY_TYPE','MODEL_NAME'],page:1,pageSize:24,received:1,rejected:0,observedAt,...patch};
}
const forbidden=()=>{assert.fail('schema inspection must not invoke source access or fallback recovery');};
function dependencies(extra:Record<string,unknown>={}){
 return {password:forbidden,assertEnabled:async()=>{},reserve:async()=>forbidden(),fetcher:async()=>forbidden(),endpoint:forbidden,
  readLegacyQuery:async()=>forbidden(),readSavedSearch:async()=>forbidden(),readDetail:async()=>forbidden(),readListedDetail:async()=>forbidden(),...extra} as any;
}

test('saved source fields use only the canonical exact first-page key and existing prepared cache',async()=>{
 let calls=0;const keys:string[]=[];
 const input={table:'stats' as const,make:'Toyota',sort:'totalRubDesc',powerTo:160,page:3};
 const expected=ajesSourceCacheSql(ajesQuery({...input,page:1}).sql);
 const client=createAjesClient(dependencies({readQuery:async(sql:string)=>{calls++;keys.push(sql);return saved(undefined,{sourceFields:['body_type','ID','BODY_TYPE','UNRELATED_CUSTOM_COLUMN']});}}));
 assert.deepEqual(await client.readSavedSourceFields(input),['BODY_TYPE','ID']);
 assert.deepEqual(await client.readSavedSourceFields(input),['BODY_TYPE','ID']);
 assert.equal(calls,1);assert.deepEqual(keys,[expected]);
 assert.equal(input.page,3,'the caller query is not mutated');
});

test('source fields already in the fresh source cache need no storage, quota, password or new source request',async()=>{
 let inspect=false,fetches=0,passwords=0,reserves=0,reads=0;
 const client=createAjesClient({password:()=>{passwords++;assert.equal(inspect,false);return 'private-fixture';},assertEnabled:async()=>{},
  reserve:async()=>{reserves++;assert.equal(inspect,false);},readQuery:async()=>{reads++;assert.equal(inspect,false);return null;},fetcher:async()=>{
   fetches++;assert.equal(inspect,false);return new Response(JSON.stringify([source]));
  }});
 await client.read({table:'stats'},'203.0.113.11');
 const before={fetches,passwords,reserves,reads};inspect=true;
 const fields=await client.readSavedSourceFields({table:'stats'});
 assert.ok(fields?.includes('BODY_TYPE'));
 assert.deepEqual({fetches,passwords,reserves,reads},before);
});

test('saved schema age is the original observation: zero through strictly less than seven days',async(t)=>{
 let now=Date.now(),stored=saved(new Date(now).toISOString());
 const clock=t.mock.method(Date,'now',()=>now);
 const client=createAjesClient(dependencies({readQuery:async()=>stored}));
 const original=stored.observedAt;
 assert.deepEqual(await client.readSavedSourceFields({}),['BODY_TYPE','ID','MODEL_NAME']);
 now+=7*86400000-1;
 assert.deepEqual(await client.readSavedSourceFields({}),['BODY_TYPE','ID','MODEL_NAME']);
 assert.equal(stored.observedAt,original);
 now++;
 assert.equal(await client.readSavedSourceFields({}),undefined);
 assert.equal(stored.observedAt,original);
 stored=saved(new Date(now+1).toISOString());
 assert.equal(await client.readSavedSourceFields({}),undefined,'future observation is not usable');
 clock.mock.restore();
});

test('invalid schema metadata, version or page binding cannot establish source columns',async()=>{
 for(const patch of [{schemaVersion:1},{page:2},{pageSize:48},{observedAt:'invalid'},
  {sourceFields:null},{sourceFields:['BODY_TYPE',7]},{sourceFields:['BODY_TYPE','column; select *']},{sourceFields:['BODY_TYPE','x'.repeat(65)]}]){
  const client=createAjesClient(dependencies({readQuery:async()=>saved(undefined,patch)}));
  assert.equal(await client.readSavedSourceFields({}),undefined,JSON.stringify(patch));
 }
 const client=createAjesClient(dependencies({readQuery:async()=>saved(undefined,{sourceFields:[]})}));
 assert.deepEqual(await client.readSavedSourceFields({}),[]);
});

test('owner disable blocks saved schema reads including cached values and a queued storage result',async()=>{
 let enabled=true,reads=0;
 const check=async()=>{if(!enabled)throw new AjesUnavailable('disabled');};
 const client=createAjesClient(dependencies({assertEnabled:check,readQuery:async()=>{reads++;return saved();}}));
 await client.readSavedSourceFields({});enabled=false;
 await assert.rejects(client.readSavedSourceFields({}),/disabled/);assert.equal(reads,1);
 const late=createAjesClient(dependencies({assertEnabled:check,readQuery:async()=>{enabled=false;return saved();}}));
 enabled=true;await assert.rejects(late.readSavedSourceFields({}),/disabled/);
});

test('invalid or non-list requests are rejected before storage and source operations',async()=>{
 let enabled=0;
 const client=createAjesClient(dependencies({assertEnabled:async()=>{enabled++;},readQuery:async()=>forbidden()}));
 for(const query of [null,[],{table:'china'},{page:0},{page:2.5},{pageSize:49},{make:"Toyota' OR 1=1"},{sql:'select *'},
  {aggregate:'count'},{aggregate:'models'},{id:'field-fixture'}]){
  await assert.rejects(client.readSavedSourceFields(query));
 }
 assert.equal(enabled,0);
});

test('missing or failed exact storage returns unknown schema without recovery or logging its content',async(t)=>{
 const warn=t.mock.method(console,'warn',()=>forbidden());
 const missing=createAjesClient(dependencies({readQuery:async()=>null}));
 assert.equal(await missing.readSavedSourceFields({}),undefined);
 const failed=createAjesClient(dependencies({readQuery:async()=>{throw Error('private fixture storage content');}}));
 assert.equal(await failed.readSavedSourceFields({}),undefined);
 const unconfigured=createAjesClient(dependencies());
 assert.equal(await unconfigured.readSavedSourceFields({}),undefined);
 assert.equal(warn.mock.callCount(),0);warn.mock.restore();
});

test('saved schema lookup compiles the same calculation-index-dependent drive query as the reader',async()=>{
 const facts=compileModelFacts({id:'model',make:'Fixture',model:'Model',revision:'1',variants:[
  {id:'v1',year:2023,trim:'1.5 AT',status:'observed',markets:['china'],chassisCode:'TESTCODE',drive:'fwd'},
 ]});
 const models={fixture:facts};const index:CalculationIndex={version:1,digest:checksum(models),manifestDigest:'test',createdAt:'2026-11-28',models};
 let reads=0,indexReads=0;
 const input={table:'stats' as const,drive:'fwd',page:2};
 const expected=ajesSourceCacheSql(ajesQuery({...input,page:1},index).sql);
 assert.notEqual(expected,ajesSourceCacheSql(ajesQuery({...input,page:1}).sql));
 const client=createAjesClient(dependencies({calculationIndex:()=>{indexReads++;return index;},readQuery:async(sql:string)=>{reads++;assert.equal(sql,expected);return saved();}}));
 assert.ok((await client.readSavedSourceFields(input))?.includes('BODY_TYPE'));
 assert.equal(reads,1);assert.equal(indexReads,1);
});
