import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('default saved calculation recalculates canonical hybrid corrections while shared archived version keeps its inputs',async()=>{
 const offer:any={id:'card',make:'Changan',model:'A06',year:2026,market:'china',sourceId:'fixture',sourceOfferId:'one',sourcePrice:100000,sourceCurrency:'CNY',fuel:'hybrid',engineCc:1497,powerHp:98,powertrainKind:'series_hybrid',icePowerKw:72,power30MinKw:45};
 const old={...offer},latest={...old,power30MinKw:60};
 const index={version:1,revision:'ency',models:{'changan:a06':{'encyclopedia:model:variant':{offerId:'encyclopedia:model:variant',key:'changan:a06',year:2026,version:'new',savedAt:'2026-11-01T10:02:00Z',values:latest,previousValues:[old]}}}};
 const state:any={index,record:null,reads:[]};(globalThis as any).__savedHybridRevision=state;
 const mocks:any={'saved-calculation-previews':`export const publishSavedCalculationPreview=async()=>{};`,data:`export const getDataRoot=()=>'/tmp';export const readDataJson=async(key,fallback)=>{const s=globalThis.__savedHybridRevision;s.reads.push(key);return key.startsWith('knowledge/')?s.index:s.record};export const mutateDataJson=()=>{throw Error('read-only')};`,
 'customs-pricing':`export const calculateOfferWithCustomerParametersDetailed=async(offer,p)=>({ok:true,calculation:{totalRub:offer.sourcePrice*10+p.power30MinKw*1000,breakdown:[]}});`};
 const output=await build({entryPoints:['apps/web/lib/catalog/saved-offer-calculation.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,plugins:[{name:'fixture',setup(b){b.onResolve({filter:/.*/},a=>{const key=a.path.split('/').at(-1)!;return mocks[key]?{path:key,namespace:'fixture'}:undefined;});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path]}));}}]});
 const module={exports:{} as any};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);
 try{
  const version='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  state.record={offerId:offer.id,identity:module.exports.savedOfferIdentity(offer),version,savedAt:'2026-11-01T10:01:00Z',draft:{year:'2026',fuel:'hybrid',engineCc:'1497',powerHp:'98',hybridKind:'series_hybrid',icePowerKw:'72',power30MinKw:'45',deliveryCity:'Новокузнецк'},calculation:{totalRub:1045000}};
  const fresh=await module.exports.getSavedOfferCalculation(offer);assert.equal(fresh.draft.power30MinKw,'60');assert.equal(fresh.calculation.totalRub,1060000);assert.equal(fresh.draft.deliveryCity,'');assert.equal(fresh.version,version);
  state.reads=[];const shared=await module.exports.getSavedOfferCalculation({...offer,sourcePrice:120000},version);assert.equal(shared.draft.power30MinKw,'45');assert.equal(shared.draft.deliveryCity,'Новокузнецк');assert.equal(shared.calculation.totalRub,1245000);assert.ok(!state.reads.some((key:string)=>key.startsWith('knowledge/')),'archive must not consult mutable knowledge');
  assert.equal(state.record.draft.power30MinKw,'45');
 }finally{delete (globalThis as any).__savedHybridRevision;}
});
