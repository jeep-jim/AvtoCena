import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadModelSuggestions} from '../apps/web/lib/catalog/model-suggestion-loader';
test('supplier suggestions include models outside the visible page and share mobile/desktop requests',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url:any)=>{calls++;assert.match(String(url),/source-models\?market=china/);return Response.json({version:1,brands:[],models:Array.from({length:80},(_,i)=>['TEST','MODEL '+i,[],1])});};
 try{
  const [a,b]=await Promise.all([loadModelSuggestions(true,{market:'china',make:''}),loadModelSuggestions(true,{market:'china',make:''})]);
  assert.equal(calls,1);assert.equal(a,b);assert.ok(a('MODEL 79','TEST').some(row=>row.model==='MODEL 79'));
 }finally{globalThis.fetch=original;}
});
test('failed provider directory is evicted so explicit retry can recover',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>++calls===1?new Response('',{status:503}):Response.json({version:1,brands:[],models:[['TEST','RECOVERED',[],1]]});
 try{
  await assert.rejects(loadModelSuggestions(true,{market:'korea',make:'TEST'}));
  const search=await loadModelSuggestions(true,{market:'korea',make:'TEST'});assert.equal(calls,2);assert.equal(search('RECOVERED','TEST')[0].model,'RECOVERED');
 }finally{globalThis.fetch=original;}
});

test('empty supplier directory is a valid result, with no browser HTTP cache',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(_url,options)=>{calls++;assert.equal(options?.cache,'no-store');return Response.json({version:1,brands:[],models:[]});};
 try{const search=await loadModelSuggestions(false,{market:'china',make:'EMPTY'});assert.deepEqual(search('anything','EMPTY'),[]);assert.equal(calls,1);}finally{globalThis.fetch=original;}
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
