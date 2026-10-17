import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {createRequire} from "node:module";
import path from "node:path";
const require=createRequire(import.meta.url);

test("save endpoint checks session, role, origin and input; recalculates server-side before writing",async()=>{
 const state:any={user:null,offer:{id:"lot",market:"korea"},calculations:0,saves:0};
 (globalThis as any).__savedRouteTest=state;
 const sources:Record<string,string>={
 "@/lib/crm-activity":`export const recordCrmActivity=async()=>{};export const activityPerson=u=>({id:u.id,name:u.displayName});export const activityChanges=()=>[];`,
  "@/lib/auth":`export const getCurrentUser=async()=>globalThis.__savedRouteTest.user;export const isCrmRole=role=>['owner','admin','manager'].includes(role);`,
  "@/lib/catalog/storage":`export const getOfferFromCurrentShard=async()=>globalThis.__savedRouteTest.offer;`,
  "@/lib/catalog/customs-pricing":`export const calculateOfferWithCustomerParametersDetailed=async(offer,parameters)=>{globalThis.__savedRouteTest.calculations++;return {ok:true,calculation:{totalRub:2500000}};};`,
  "@/lib/catalog/saved-offer-calculation":`export {cleanSavedDraft,SavedCalculationConflict} from '${path.resolve('apps/web/lib/catalog/saved-offer-calculation.ts')}';export const getSavedOfferCalculation=async()=>null;export const saveOfferCalculation=async(offer,draft,calculation,userId,version)=>{const s=globalThis.__savedRouteTest;s.saves++;s.saved={draft,calculation,userId,version};return {...s.saved,version:'v2',savedAt:'2026-09-20T10:00:00Z'};};`
 };
 const result=await build({entryPoints:['apps/web/app/api/catalog/offer/[id]/save/route.ts'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'route-boundaries',setup(b){b.onResolve({filter:/^@\/lib\//},args=>sources[args.path]?{path:args.path,namespace:'boundary'}:undefined);b.onLoad({filter:/.*/,namespace:'boundary'},args=>({contents:sources[args.path],loader:'ts',resolveDir:process.cwd()}));}}]});
 const module={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
 const draft={year:"2021",fuel:"petrol",engineCc:"1998",powerHp:"150"};
 const request=(body:any={draft,version:null,totalRub:1},origin="https://avtocena.com")=>new Request("https://avtocena.com/api/catalog/offer/lot/save",{method:"POST",headers:{origin,"Content-Type":"application/json"},body:JSON.stringify(body)});
 const post=(req:Request)=>module.exports.POST(req,{params:{id:"lot"}});
 try {
  assert.equal((await post(request())).status,403);assert.equal(state.calculations,0);assert.equal(state.saves,0);
  state.user={id:"partner",role:"partner"};assert.equal((await post(request())).status,403);
  for(const role of ["owner","admin","manager"]){state.user={id:role,role};const response=await post(request());assert.equal(response.status,200);assert.equal((await response.json()).calculation.totalRub,2500000);assert.equal(state.saved.userId,role);}
  const before=state.saves;
  assert.equal((await post(request(undefined,"https://attacker.example"))).status,403);
  assert.equal((await post(request({draft:{...draft,fuel:"hybrid"}}))).status,400);
  assert.equal(state.saves,before);
  state.offer=null;assert.equal((await post(request())).status,404);assert.equal(state.saves,before);
 }finally{delete (globalThis as any).__savedRouteTest;}
});
