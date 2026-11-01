import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);

test('complete AJES rows reuse exact local facts; compact rows still verify price and identity',async()=>{
 const state={reads:[] as string[],calculated:[] as any[],records:new Map<string,any>(),revision:'knowledge-1',hp:150};
 (globalThis as any).__managementReuse=state;
 const stubs:Record<string,string>={
  './management-knowledge':`export const invalidateManagementPrice=o=>o; export const attachManagementKnowledge=async rows=>rows.map(o=>({...o,operational:{...o.operational,managementKnowledge:{revision:globalThis.__managementReuse.revision,parameters:{powerHp:globalThis.__managementReuse.hp,drive:'awd'}}}}));`,
  './power30-precedent':`export const offerPrecedentParameterDraft=o=>({year:String(o.year),fuel:o.fuel,engineCc:String(o.engineCc),powerHp:String(o.powerHp||o.operational.managementKnowledge.parameters.powerHp)});`,
  './customer-parameters':`export const validateCustomerParameters=x=>({...x});`,
  './customs-pricing':`export const calculateOfferWithCustomerParametersDetailed=async(o,p)=>{globalThis.__managementReuse.calculated.push({offer:o,parameters:p});return {ok:true,calculation:{totalRub:o.sourcePrice*2+Number(p.powerHp)}};};`,
  './offer-page-data':`export const getOfferForPage=async id=>{globalThis.__managementReuse.reads.push(id);return globalThis.__managementReuse.records.get(id)||null;};`,
 };
 try{
  const built=await build({entryPoints:['apps/web/lib/catalog/management-previews.ts'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'reuse-fixture',setup(b){b.onResolve({filter:/.*/},a=>a.path in stubs?{path:a.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path]}));}}]});
  const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);
  const base=(market:string,n:number)=>({id:`ajes-${market==='japan'?'stats':market}-${n}`,sourceId:`ajes_${market}_feed`,sourceOfferId:String(n),market,year:2023,fuel:'petrol',engineCc:1600,sourcePrice:100000+n,sourceCurrency:market==='japan'?'JPY':market==='korea'?'KRW':'CNY',updatedAt:'2026-10-27T15:00:00Z',operational:{raw:{sourceDrive:'4WD'},managementKnowledge:{revision:'knowledge-1',parameters:{powerHp:150,drive:'awd'}}}});
  const rows=Array.from({length:24},(_,i)=>base(['japan','korea','china'][i%3],i));
  for(const row of rows)state.records.set(row.id,row);
  const result=await mod.exports.attachManagementPreviews(rows,{version:'one'});
  assert.equal(state.reads.length,0,'SELECT * rows must not refetch 24 details');
  assert.equal(state.calculated.length,24);
  result.forEach((row:any,i:number)=>{assert.equal(row.savedCalculationPreview.totalRub,rows[i].sourcePrice*2+150);assert.deepEqual(state.calculated[i].offer,rows[i]);assert.equal(row.sourcePrice,rows[i].sourcePrice);});
  await mod.exports.attachManagementPreviews(rows,{version:'one'});assert.equal(state.calculated.length,24,'same complete inputs reuse bounded quote');
  state.revision='knowledge-2';state.hp=160;
  const revised=await mod.exports.attachManagementPreviews([{...rows[0],sourcePrice:200000}],{version:'one'});
  assert.equal(revised[0].savedCalculationPreview.totalRub,400160,'new knowledge and recipient price invalidate the quote');
  assert.equal(state.reads.length,0);
  const compact={...base('korea',100),cardProjectionVersion:3};state.records.set(compact.id,{...base('korea',100),sourcePrice:999});
  assert.equal((await mod.exports.attachManagementPreviews([compact],{version:'one'}))[0].savedCalculationPreview,undefined,'changed authoritative price must not get a quote');
  const publicRow={...base('korea',101),operational:undefined};state.records.set(publicRow.id,base('korea',101));
  assert.ok((await mod.exports.attachManagementPreviews([publicRow],{version:'one'}))[0].savedCalculationPreview);
  const wrong={...base('korea',102),sourceOfferId:'different'};state.records.set(wrong.id,{...wrong,market:'china'});
  assert.equal((await mod.exports.attachManagementPreviews([wrong],{version:'one'}))[0].savedCalculationPreview,undefined);
  assert.deepEqual(state.reads,[compact.id,publicRow.id,wrong.id]);
 }finally{delete (globalThis as any).__managementReuse;}
});
