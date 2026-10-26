import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('confirmed save learns the edited drive and only management can update shared knowledge',async()=>{
 const state:any={team:true,origin:true,learned:[],saved:0};(globalThis as any).__managementSaveTest=state;
 const mocks:any={
 'next/cache':`export const revalidatePath=()=>{};`,'next/server':`export const NextResponse={json:(v,o)=>Response.json(v,o)};`,
 'editorial':`export const readCatalogEditorial=async()=>({});export const applyCatalogEditorial=o=>({...o,drive:'awd'});`,
 'platform-access':`export const isPlatformTeam=()=>globalThis.__managementSaveTest.team;`,
 'management-knowledge':`export const rememberManagementCalculation=async(o,r)=>globalThis.__managementSaveTest.learned.push({offer:o,record:r});`,
 'crm-permissions':`export const hasCrmPermission=()=>true;`,
 'crm-activity':`export const recordCrmActivity=async()=>{};export const activityChanges=()=>[];export const activityPerson=()=>({});`,
 'auth':`export const getCurrentUser=async()=>({id:'staff',displayName:'Staff'});export const isCrmRole=()=>true;`,
 'calculation-request-origin':`export const isCalculationOriginAllowed=()=>globalThis.__managementSaveTest.origin;`,
 'storage':`export const getOfferFromCurrentShard=async()=>({id:'car',make:'Honda',model:'Vezel',year:2025,drive:'fwd'});`,
 'customer-parameters':`export const validateCustomerParameters=d=>d;`,
 'customs-pricing':`export const calculateOfferWithCustomerParametersDetailed=async()=>({ok:true,calculation:{totalRub:1234567}});`,
 'saved-offer-calculation':`export class SavedCalculationConflict extends Error{};export const cleanSavedDraft=d=>d;export const getSavedOfferCalculation=async()=>null;export const saveOfferCalculation=async(o,d,c)=>{globalThis.__managementSaveTest.saved++;return {version:'revision',savedAt:'now',draft:d,calculation:c};};`
 };
 const output=await build({entryPoints:['apps/web/app/api/catalog/offer/[id]/save/route.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,plugins:[{name:'fixture',setup(b){b.onResolve({filter:/.*/},a=>{const key=a.path.startsWith('next/')?a.path:a.path.split('/').at(-1)!;return mocks[key]?{path:key,namespace:'fixture'}:undefined;});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path]}));}}]});
 const module={exports:{} as any};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);
 const request=()=>new Request('https://avtocena.com/api/catalog/offer/car/save',{method:'POST',body:JSON.stringify({draft:{powerHp:'150'},version:null})});
 try{
  const response=await module.exports.POST(request(),{params:Promise.resolve({id:'car'})});assert.equal(response.status,200);assert.equal((await response.json()).knowledgeSaved,true);assert.equal(state.learned[0].offer.drive,'awd');
  state.team=false;await module.exports.POST(request(),{params:Promise.resolve({id:'car'})});assert.equal(state.learned.length,1);assert.equal(state.saved,2);
  state.origin=false;assert.equal((await module.exports.POST(request(),{params:Promise.resolve({id:'car'})})).status,403);assert.equal(state.saved,2);
 }finally{delete (globalThis as any).__managementSaveTest;}
});
