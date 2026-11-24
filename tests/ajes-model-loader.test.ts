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
