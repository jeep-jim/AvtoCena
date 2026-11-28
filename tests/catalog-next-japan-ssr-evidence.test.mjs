import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {japanSsrPageReadEvidence,readJapanSsrPageEvidence,verifyJapanPage}
  from '../scripts/catalog-next/japan-browser-acceptance.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const after='j1.2.3.2.'+'a'.repeat(64)+'.'+'b'.repeat(64);
const expected={page:2,after};
const receipt=(index=3)=>({version:1,requestId:'12345678-1234-4234-8234-'+String(index).padStart(12,'0'),
  queryHash:'c'.repeat(64),table:'stats',kind:'list',page:index,pageSize:24,
  startedAt:'2026-11-27T06:42:50.000Z',finishedAt:'2026-11-27T06:42:51.000Z',stage:'supplier',
  supplierAttempted:true,outcome:'stale',reason:'invalid_response',observedAt:'2026-11-27T01:56:14.520Z'});
const annotation=(patch={})=>JSON.stringify({version:1,page:2,afterSha256:hash(after),receipts:[receipt()],omitted:0,...patch});

test('SSR annotation preserves the first source failure separately from a subsequent cooldown receipt',()=>{
  const evidence=japanSsrPageReadEvidence(annotation(),expected);
  assert.equal(evidence.status,'recorded');assert.equal(evidence.bindingMatched,true);
  assert.deepEqual(evidence.receipts,[receipt()]);assert.equal(evidence.received,1);assert.equal(evidence.omitted,0);
  assert(!JSON.stringify(evidence).includes(after));
  const verification=japanSsrPageReadEvidence(annotation({receipts:[{...receipt(),stage:'empty_verification'}]}),expected);
  assert.equal(verification.receipts[0].stage,'empty_verification');
  const cooldown=japanSsrPageReadEvidence(annotation({receipts:[{...receipt(),stage:'cooldown',supplierAttempted:false}]}),expected);
  assert.equal(cooldown.receipts[0].supplierAttempted,false);
  assert.throws(()=>verifyJapanPage({ok:true,stale:true,partial:true,items:[],ssrPageReadEvidence:evidence},200),/unavailable_or_stale/);
});

test('unknown fields, secrets, malformed evidence, wrong binding and oversize are omitted without copying input',()=>{
  for(const raw of [annotation({sql:'PRIVATE_SECRET'}),annotation({receipts:[{...receipt(),body:'PRIVATE_SECRET'}]}),
    annotation({receipts:[{...receipt(),reason:'PRIVATE_SECRET'}]}),annotation({receipts:[{...receipt(),requestId:'PRIVATE_SECRET'}]}),
    annotation({receipts:Array.from({length:9},(_,index)=>receipt(index+1))}),annotation({omitted:-1}),
    annotation({omitted:1_000_001}),annotation({page:1}),annotation({afterSha256:hash('other')}),
    'PRIVATE_SECRET',annotation({private:'PRIVATE_SECRET'.repeat(1000)}),{raw:'PRIVATE_SECRET'}]){
    const evidence=japanSsrPageReadEvidence(raw,expected);
    assert.notEqual(evidence.status,'recorded');assert.equal(evidence.receipts.length,0);
    assert(!JSON.stringify(evidence).includes('PRIVATE_SECRET'));
  }
  assert.equal(japanSsrPageReadEvidence(null,expected).status,'missing');
  assert.equal(japanSsrPageReadEvidence(annotation(),{page:2,after:'x'.repeat(513)}).bindingMatched,false);
  const partial=japanSsrPageReadEvidence(annotation({receipts:[receipt(),{...receipt(4),sql:'PRIVATE_SECRET'}],omitted:8}),expected);
  assert.equal(partial.status,'partial');assert.equal(partial.received,10);assert.equal(partial.omitted,9);assert.equal(partial.limited,true);
  assert.deepEqual(partial.receipts,[receipt()]);
});

test('browser capture waits past stale DOM page one and a mismatched cursor while URL is already page two',async()=>{
  const oldDocument=globalThis.document;let current=annotation({page:1,afterSha256:hash('')}),disposed=false,polls=0;
  const calls=[];
  globalThis.document={querySelectorAll(selector){assert.equal(selector,'main.ac-ajes-catalog');return [{getAttribute(name){
    assert.equal(name,'data-japan-source-receipts');calls.push('attribute');return current;
  }}];}};
  const page={url:()=> 'https://avtocena.com/cars?market=japan&page=2',waitForFunction:async(fn,args,options)=>{
    assert.equal(options.timeout,5000);polls++;assert.equal(fn(args),false,'URL page two cannot authorize page-one metadata');
    current=annotation({afterSha256:hash('different-cursor')});polls++;assert.equal(fn(args),false);
    current=annotation();polls++;const observed=fn(args);assert.equal(typeof observed,'string');
    return {jsonValue:async()=>observed,dispose:async()=>{disposed=true;}};
  }};
  try{
    const result=await readJapanSsrPageEvidence(page,expected);
    assert.equal(result.bindingMatched,true);assert.equal(result.page,2);assert.deepEqual(result.receipts,[receipt()]);
    assert.equal(polls,3);assert.deepEqual(calls,['attribute','attribute','attribute']);assert.equal(disposed,true);
  }finally{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;}
});

test('missing or changed DOM evidence is additive and never leaks an error or changes a freshness gate',async()=>{
  const missing=await readJapanSsrPageEvidence({waitForFunction:async()=>{throw Error('PRIVATE_URL_AND_BODY');}},expected);
  assert.equal(missing.status,'missing');assert.deepEqual(missing.omissions,['bound_dom_not_observed']);
  assert(!JSON.stringify(missing).includes('PRIVATE_'));
  let disposed=false;
  const changed=await readJapanSsrPageEvidence({waitForFunction:async()=>({jsonValue:async()=>annotation({page:1}),
    dispose:async()=>{disposed=true;}})},expected);
  assert.equal(changed.bindingMatched,false);assert.equal(changed.receipts.length,0);assert.equal(disposed,true);
  const now=Date.parse('2026-11-27T06:42:55.000Z');
  const fresh={ok:true,stale:false,partial:false,observedAt:new Date(now-1000).toISOString(),items:[{id:'ajes-stats-1',market:'japan'}]};
  assert.equal(verifyJapanPage({...fresh,ssrPageReadEvidence:missing},200,now).shown,1);
  assert.throws(()=>verifyJapanPage({...fresh,stale:true,ssrPageReadEvidence:japanSsrPageReadEvidence(annotation(),expected)},200,now),/unavailable_or_stale/);
});

test('both continuation paths observe SSR before their existing API read without adding a request',async()=>{
  const source=await fs.readFile(new URL('../scripts/catalog-next/japan-browser-acceptance.mjs',import.meta.url),'utf8');
  const standard=source.slice(source.indexOf('const checkPaginationUi=async'),source.indexOf('const plain=[]'));
  const petrol=source.slice(source.indexOf("stage='completion_petrol_power_page_two'"),source.indexOf('const nextAggregate='));
  for(const block of [standard,petrol]){
    const navigated=block.indexOf('waitForURL'),observed=block.indexOf('readJapanSsrPageEvidence');
    const apiRead=block.search(/await\s+read\(/);
    assert(navigated>=0&&observed>navigated);
    assert(apiRead>observed);
    assert.equal((block.match(/await\s+read\(/g)||[]).length,1);
    assert.equal((block.match(/await\s+readJson\(/g)||[]).length,0,'continuation uses the exact-aware single-read adapter');
    assert.equal((block.match(/explicitJapanApiRequests\+\+/g)||[]).length,1);
    assert(block.includes('if(stability)'));
  }
});

test('exact-aware read adapter performs one existing API request and only validates its returned payload',async()=>{
  const source=await fs.readFile(new URL('../scripts/catalog-next/japan-browser-acceptance.mjs',import.meta.url),'utf8');
  const start=source.indexOf('const read=async(url,options={})=>{');
  const end=source.indexOf('const verifyPower=',start);
  assert(start>=0&&end>start);
  const adapter=source.slice(start,end);
  assert.equal((adapter.match(/await\s+readJson\(/g)||[]).length,1);
  const createRead=new Function('context','requireExactCount','requireModelCoverage','requireSourceCount','readJson','verifyJapanExactCount',adapter+'\nreturn read;');
  const existingUrl='/api/catalog/search?market=japan&page=2',existingOptions={paginationKind:'plain',requirePowerOrder:true};
  const profiles=[
    ...[false,true].map(requireExactCount=>({requireExactCount,requireModelCoverage:false,url:existingUrl,options:existingOptions})),
    {requireExactCount:false,requireModelCoverage:true,
      url:'/api/catalog/source-models?market=japan&make=AUDI',options:{}},
    {requireExactCount:false,requireModelCoverage:true,
      url:'/api/catalog/search?'+new URLSearchParams({market:'japan',page:'1',pageSize:'24',city:'Новокузнецк',make:'AUDI',model:'A4'}),
      options:{exactCount:true,modelCoverage:false,sourceCount:true}},
    {requireExactCount:false,requireModelCoverage:true,requireSourceCount:true,
      url:'/api/catalog/search?'+new URLSearchParams({market:'japan',page:'1',pageSize:'24',city:'Новокузнецк',make:'Audi',model:'A4',countOnly:'1'}),
      options:{exactCount:true,modelCoverage:false,sourceCount:false}},
  ];
  for(const {requireExactCount,requireModelCoverage,requireSourceCount=false,url,options} of profiles){
    const calls=[],value={status:200,data:{ok:true,items:[],total:null,countSummary:null}},
      context={request:{get(){assert.fail('adapter cannot bypass readJson');}}};
    const read=createRead(context,requireExactCount,requireModelCoverage,requireSourceCount,async(actualContext,actualUrl,actualOptions)=>{
      calls.push('api');assert.equal(actualContext,context);assert.equal(actualUrl,url);
      assert.deepEqual(actualOptions,{...options,exactCount:requireExactCount,modelCoverage:requireModelCoverage,sourceCount:requireSourceCount});return value;
    },(payload,binding)=>{calls.push('validate');assert.equal(payload,value.data);assert.deepEqual(binding,{query:url});});
    assert.equal(await read(url,options),value);
    assert.deepEqual(calls,requireExactCount?['api','validate']:['api'],
      'incremental and source-count reads must not invoke the positive-exact validator or issue a second API call');
  }
});

