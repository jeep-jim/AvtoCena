import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {canDeleteCustomerReview} from '../apps/web/lib/account/review-moderation';
import {customerNotices} from '../apps/web/lib/account/notifications';
import {CUSTOMER_AVATARS,customerAvatar,validCustomerAvatar} from '../apps/web/lib/account/avatars';
const require=createRequire(import.meta.url);
test('review deletion requires an explicit capability except for owner',()=>{
 for(const user of [null,{role:'manager'},{role:'dealer',permissions:{deleteReviews:true}},{role:'owner',companyId:'other'},{role:'admin',status:'disabled',permissions:{deleteReviews:true}}])assert.equal(canDeleteCustomerReview(user&&{id:'u',companyId:'dealer_topavto',...user} as any),false);
 for(const role of ['owner','admin'])assert.equal(canDeleteCustomerReview({id:'u',companyId:'dealer_topavto',role,permissions:{deleteReviews:true}} as any),true);
});
test('twenty-four local avatars are stable and accept no arbitrary URL',()=>{assert.equal(new Set(CUSTOMER_AVATARS.map(a=>a.url)).size,24);assert.equal(customerAvatar('same'),customerAvatar('same'));assert.equal(validCustomerAvatar('https://example.com/a'),false);assert.equal(validCustomerAvatar('character-21'),false);});
test('notifications exclude own messages and link review eligibility to reviews',()=>{const notices=customerNotices([{leads:[{id:'l',title:'Авто',status:'Договор',updatedAt:'2026-10-05T00:00:00Z',canReview:true,reviewAvailableAt:'2026-10-05T02:00:00Z'}],documents:[],messages:[{id:'own',mine:true,createdAt:'2026-10-05T01:00:00Z'},{id:'reply',mine:false,author:'Менеджер',text:'Здравствуйте',createdAt:'2026-10-05T01:00:00Z'}]}]);assert.equal(notices.length,3);assert.equal(notices[1].id,'message:reply');assert.equal(notices[0].href,'/account?tab=reviews');assert.match(notices[0].id,/^review:lead|^review:l:/);});
test('review publication, retries, deletion and access boundaries use real route handlers',async()=>{
 const state:any={account:{id:'a'.repeat(64),name:'Покупатель'},actor:null,review:null,client:{id:'client',portalAccountId:'a'.repeat(64),documents:[{id:'contract',customerVisible:true}],portalContracts:{}},writes:0};(globalThis as any).__controls=state;
 const mocks:Record<string,string>={
 '@/lib/dealers/showcase-store':'export const findDealer=async()=>({status:"verified"});',
 '@/lib/auth':'export const getCurrentUser=async()=>globalThis.__controls.actor;',
 '@/lib/account/auth':'export const currentAccount=async()=>globalThis.__controls.account;export const hash=s=>require("node:crypto").createHash("sha256").update(s).digest("hex");export const accountRateLimit=async()=>true;',
 '@/lib/account/portal':'export const linkedClient=async(a,key)=>{if(key!=="owned")throw Error("Нет доступа.");return {link:{companyId:"dealer_topavto"},client:globalThis.__controls.client}};export const customerLeads=async()=>[{id:"lead",dealerId:"dealer_topavto"}];export const clientsPath=()=>"clients";export const linksPath=()=>"links";export const portalData=async()=>[];export const sendPortalMessage=async()=>{};',
 '@/lib/data':'export const mutateDataJson=async()=>{};export const readChunkedDataJson=async()=>[];export const appendChunkedDataJson=async(p,r)=>{const s=globalThis.__controls;if(!s.review){s.review=r;s.writes++;}return s.review;};export const updateChunkedDataJson=async(p,id,fn)=>{const s=globalThis.__controls;if(p==="clients"){s.client=fn(s.client);return s.client;}if(s.review?.id!==id)return null;s.review=fn(s.review);return s.review;};'
 };
 async function load(entry:string){const r=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,plugins:[{name:'controls',setup(b){b.onResolve({filter:/^@\//},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'ts'}));}}]});const m={exports:{} as any};new Function('require','module','exports',r.outputFiles[0].text)(require,m,m.exports);return m.exports;}
 const request=(body:any,origin='https://avtocena.com')=>new Request('https://avtocena.com/api/account/portal',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{const portal=await load('apps/web/app/api/account/portal/route.ts'),moderate=await load('apps/web/app/api/account/review-moderation/route.ts');const body={action:'review',key:'owned',leadId:'lead',rating:4.2,text:'Спасибо за работу, всё прошло хорошо.'};
 assert.equal((await portal.POST(request(body))).status,400);assert.equal(state.writes,0);
 state.client.portalContracts.lead={documentId:'contract',dealerId:'dealer_topavto',confirmedBy:'manager',confirmedAt:new Date().toISOString()};
 assert.equal((await portal.POST(request({...body,key:'other'}))).status,400);assert.equal((await portal.POST(request(body,'https://evil.example'))).status,403);
 assert.equal((await portal.POST(request({...body,rating:6}))).status,400);
 assert.equal((await portal.POST(request(body))).status,200);assert.equal(state.writes,1);assert.equal(state.review.rating,4.2);const original=JSON.stringify(state.review);
 assert.equal((await portal.POST(request({...body,text:'Changed review content'}))).status,400);assert.equal(JSON.stringify(state.review),original);
 const deletion={action:'delete',dealerId:'dealer_topavto',reviewId:state.review.id};state.actor={id:'staff',role:'manager',companyId:'dealer_topavto'};
 assert.equal((await moderate.POST(request(deletion))).status,403);
 state.actor={id:'dealer-staff',role:'dealer',companyId:'dealer_topavto',dealerApproved:true};
 assert.equal((await moderate.POST(request(deletion))).status,403);
 state.actor.permissions={deleteReviews:true};assert.equal((await moderate.POST(request({...deletion,dealerId:'other'}))).status,403);
 assert.equal((await moderate.POST(request(deletion))).status,200);assert.equal(state.review.status,'hidden');state.review.status='published';
 state.actor={id:'staff',role:'admin',companyId:'dealer_topavto'};assert.equal((await moderate.POST(request(deletion))).status,403);state.actor.permissions={deleteReviews:true};
 assert.equal((await moderate.POST(request({...deletion,action:'edit'}))).status,400);assert.equal((await moderate.POST(request(deletion))).status,200);assert.equal(state.review.status,'hidden');assert.equal(state.review.deletedBy,'staff');assert.equal(state.review.text,body.text);assert.equal((await portal.POST(request(body))).status,400);
 }finally{delete (globalThis as any).__controls;}
});
