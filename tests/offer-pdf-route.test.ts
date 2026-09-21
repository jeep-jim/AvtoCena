import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
test("PDF endpoint protects staff access and exports both incomplete and unsaved drafts without writing",async()=>{
 const state:any={user:null,offer:{id:"lot"},calculations:0,renders:0};(globalThis as any).__pdfRoute=state;
 const sources:Record<string,string>={
  "@/lib/auth":`export const getCurrentUser=async()=>globalThis.__pdfRoute.user;export const isCrmRole=r=>['owner','admin','manager'].includes(r);`,
  "@/lib/catalog/storage":`export const getOfferFromCurrentShard=async()=>globalThis.__pdfRoute.offer;`,
  "@/lib/catalog/offer-page-data":`export const getOfferForPage=async()=>globalThis.__pdfRoute.offer;`,
  "@/lib/catalog/customs-pricing":`export const calculateOfferWithCustomerParametersDetailed=async(o,p)=>{globalThis.__pdfRoute.calculations++;return {ok:true,calculation:{totalRub:2500000}};};`,
  "@/lib/catalog/saved-offer-calculation":`export const getSavedOfferCalculation=async()=>globalThis.__pdfRoute.saved || null;export const cleanSavedDraft=d=>d;`,
  "@/lib/catalog/offer-pdf":`export const offerPdfData=(o,d,c,w)=>({draft:d,calculation:c,warning:w});export const renderOfferPdf=async d=>{globalThis.__pdfRoute.renders++;globalThis.__pdfRoute.data=d;return Buffer.from('%PDF-test');};`
 };
 const result=await build({entryPoints:['apps/web/app/api/catalog/offer/[id]/pdf/route.ts'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/^@\/lib\//},a=>sources[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:sources[a.path],loader:'ts'}));}}]});
 const module={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
 const request=(draft:any={year:"2021",fuel:"petrol",engineCc:"1998",powerHp:"150"},origin="https://avtocena.com")=>new Request("https://avtocena.com/api/catalog/offer/lot/pdf",{method:"POST",headers:{origin},body:JSON.stringify({draft,totalRub:1})});
 const post=(req:Request)=>module.exports.POST(req,{params:Promise.resolve({id:"lot"})});
 try{
  assert.equal((await post(request())).status,403);state.user={role:"partner"};assert.equal((await post(request())).status,403);assert.equal(state.renders,0);
  for(const role of ['owner','admin','manager']){state.user={role};const response=await post(request());assert.equal(response.status,200);assert.match(response.headers.get('cache-control')||'',/no-store/);assert.equal(response.headers.get('content-type'),'application/pdf');assert.equal(state.data.calculation.totalRub,2500000);}
  assert.equal((await post(request({year:"2022"}))).status,200);assert.equal(state.data.calculation,null);assert.match(state.data.warning,/Не все/);
  state.saved={draft:{year:"2021",fuel:"petrol",engineCc:"1998",powerHp:"150"},calculation:{totalRub:2600000}};
  assert.equal((await post(request())).status,200);assert.equal(state.data.calculation.totalRub,2600000);
  assert.equal((await post(request({...state.saved.draft,year:"2022"}))).status,200);assert.equal(state.data.calculation.totalRub,2500000);
  const rendered=state.renders;assert.equal((await post(request(undefined,'https://attacker.example'))).status,403);assert.equal(state.renders,rendered);
  assert.equal((await post(request("not a draft"))).status,400);state.offer=null;assert.equal((await post(request())).status,404);
 }finally{delete (globalThis as any).__pdfRoute;}
});
