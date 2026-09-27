import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);
test('link calculator API rejects incomplete input, trusts engine only, and returns PDF',async()=>{
 const state:any={calls:[]};(globalThis as any).__autocalcTest=state;
 const built=await build({entryPoints:['apps/web/app/api/autocalc/route.ts'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'calculator',setup(b){
  b.onResolve({filter:/^@\/lib\/catalog\/customs-pricing$/},()=>({path:'calculator',namespace:'test'}));
  b.onResolve({filter:/^@\/lib\/catalog\/offer-pdf$/},()=>({path:'pdf',namespace:'test'}));
  b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='calculator'?`export async function calculateOfferWithCustomerParametersDetailed(offer,parameters){globalThis.__autocalcTest.calls.push({offer,parameters});return {ok:true,calculation:{totalRub:2500000,breakdown:[]}}}`:`export function offerPdfData(){return {}};export async function renderOfferPdf(){return Buffer.from('%PDF-1.7 test')}`,loader:'js'}));
 }}]});
 const m={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,m,m.exports);
 const post=(data:any,origin='https://avtocena.com')=>m.exports.POST(new Request('https://avtocena.com/api/autocalc',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(data)}));
 try{
  assert.equal((await post({},'https://evil.example')).status,403);
  assert.equal((await post({})).status,400);assert.equal(state.calls.length,0);
  assert.equal((await post({action:'extract',url:'https://127.0.0.1'})).status,400);
  assert.equal((await post({title:'x'.repeat(13000)})).status,413);
  const body={title:'Corolla',market:'china',price:100000,currency:'CNY',city:'Новокузнецк',draft:{vehicleCategory:'M1',year:2022,fuel:'petrol',engineCc:1500,powerHp:120},totalRub:1};
  const r=await post(body);assert.equal(r.status,200);assert.equal((await r.json()).totalRub,2500000);assert.equal(state.calls[0].offer.totalRub,undefined);assert.equal(state.calls[0].parameters.deliveryCity,'Новокузнецк');
  const pdf=await post({...body,action:'pdf'});assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.match(await pdf.text(),/^%PDF/);
 }finally{delete (globalThis as any).__autocalcTest;}
});
