import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadModelSuggestions} from '../apps/web/lib/catalog/model-suggestion-loader';
import {modelDirectoryMarkets} from '../apps/web/lib/catalog/market-selection';
test('supplier suggestions include models outside the visible page and share mobile/desktop requests',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url:any)=>{calls++;assert.match(String(url),/source-models\?market=japan/);return Response.json({version:1,brands:[],models:Array.from({length:80},(_,i)=>['TEST','MODEL '+i,[],1])});};
 try{
  const [a,b]=await Promise.all([loadModelSuggestions(true,{market:'japan',make:''}),loadModelSuggestions(true,{market:'japan',make:''})]);
  assert.equal(calls,1);assert.equal(a,b);assert.ok(a('MODEL 79','TEST').some(row=>row.model==='MODEL 79'));
 }finally{globalThis.fetch=original;}
});
test('failed provider directory is evicted so explicit retry can recover',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>++calls===1?new Response('',{status:503}):Response.json({version:1,brands:[],models:[['TEST','RECOVERED',[],1]]});
 try{
  await assert.rejects(loadModelSuggestions(true,{market:'japan',make:'TEST'}));
  const search=await loadModelSuggestions(true,{market:'japan',make:'TEST'});assert.equal(calls,2);assert.equal(search('RECOVERED','TEST')[0].model,'RECOVERED');
 }finally{globalThis.fetch=original;}
});

test('empty supplier directory is a valid result, with no browser HTTP cache',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(_url,options)=>{calls++;assert.equal(options?.cache,'no-store');return Response.json({version:1,brands:[],models:[]});};
 try{const search=await loadModelSuggestions(false,{market:'japan',make:'EMPTY'});assert.deepEqual(search('anything','EMPTY'),[]);assert.equal(calls,1);}finally{globalThis.fetch=original;}
});

test('stale supplier metadata preserves callable names and permits an immediate explicit retry',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({version:1,brands:[],models:[['TEST_STALE_METADATA',calls===1?'SAVED NAME':'FRESH NAME',[],3]],stale:calls===1});};
 try{
  const source={market:'japan',make:'TEST_STALE_METADATA'};
  const [saved,shared]=await Promise.all([loadModelSuggestions(true,source),loadModelSuggestions(true,source)]);
  assert.equal(calls,1);assert.equal(saved,shared);assert.equal(saved.stale,true);assert.equal(saved('','TEST_STALE_METADATA')[0].model,'SAVED NAME');
  const fresh=await loadModelSuggestions(true,source);
  assert.equal(calls,2);assert.equal(fresh.stale,false);assert.equal(fresh('','TEST_STALE_METADATA')[0].model,'FRESH NAME');
  assert.equal(await loadModelSuggestions(true,source),fresh);assert.equal(calls,2,'fresh metadata retains the existing shared cache');
 }finally{globalThis.fetch=original;}
});

test('malformed source stale metadata cannot silently become a fresh cached directory',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>Response.json({version:1,brands:[],models:[],stale:++calls===1?'false':false});
 try{
  const source={market:'japan',make:'TEST_BAD_STALE_METADATA'};
  await assert.rejects(loadModelSuggestions(true,source),/invalid_directory/);
  const fresh=await loadModelSuggestions(true,source);assert.equal(fresh.stale,false);assert.deepEqual(fresh('anything'),[]);assert.equal(calls,2);
 }finally{globalThis.fetch=original;}
});

test('canonical brands resolve to actual source names, including all Mercedes aliases',async()=>{
 const {resolveAjesMakeNames}=await import('../apps/web/lib/catalog/ajes-make-resolution');
 const names=[{make:'BENZ'},{make:'MERCEDES BENZ'},{make:'BMW'}];
 assert.equal(resolveAjesMakeNames('Mercedes-Benz',names),'BENZ,MERCEDES BENZ');
 assert.equal(resolveAjesMakeNames('벤츠',names),'BENZ,MERCEDES BENZ');
 assert.equal(resolveAjesMakeNames('BMW',names),'BMW');
 assert.equal(resolveAjesMakeNames('Unknown',names),'Unknown');
 assert.equal(resolveAjesMakeNames('BMW,Mercedes-Benz',names),'BMW,BENZ,MERCEDES BENZ');
});

test('current picker requests non-Japanese models from published inventory without selecting an AJ directory',async()=>{
 const original=globalThis.fetch;const urls:string[]=[];
 globalThis.fetch=async input=>{urls.push(String(input));return Response.json({version:1,brands:[],models:[['TEST','LOCAL',[],1]]});};
 try{
  for(const market of ['china','korea','uae']){
   // VehicleModelSearch uses this selector for its separate supplier requests.
   const supplierMarkets=modelDirectoryMarkets(market,'LOCAL_TEST',true);
   assert.deepEqual(supplierMarkets,[]);
   await Promise.all(supplierMarkets.map(sourceMarket=>loadModelSuggestions(true,{market:sourceMarket,make:'LOCAL_TEST'})));
   const search=await loadModelSuggestions(true,undefined,'LOCAL_TEST',market);
   assert.equal(search('LOCAL','TEST')[0].model,'LOCAL');
  }
  assert.equal(urls.length,3);
  for(const [index,market] of ['china','korea','uae'].entries()){
   const url=new URL(urls[index],'https://avtocena.com');
   assert.equal(url.pathname,'/api/catalog/models');assert.equal(url.searchParams.get('scope'),'inventory');
   assert.equal(url.searchParams.get('market'),market);assert.equal(url.searchParams.get('make'),'LOCAL_TEST');
  }
  assert.deepEqual(modelDirectoryMarkets('china|japan|korea','LOCAL_TEST',true),['japan']);
 }finally{globalThis.fetch=original;}
});
