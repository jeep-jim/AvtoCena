import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {canReadCustomerReviews,canDeleteCustomerReview,canReplyCustomerReview} from '../apps/web/lib/account/review-moderation';
const require=createRequire(import.meta.url);
test('dealers read their own reviews; reply and deletion are independently granted',()=>{
 const d:any={id:'d',role:'dealer',companyId:'one',dealerApproved:true};
 assert.equal(canReadCustomerReviews(d,'one'),true);assert.equal(canReadCustomerReviews(d,'two'),false);
 assert.equal(canReplyCustomerReview(d,'one'),false);assert.equal(canDeleteCustomerReview(d,'one'),false);
 d.permissions={replyReviews:true};assert.equal(canReplyCustomerReview(d,'one'),true);assert.equal(canDeleteCustomerReview(d,'one'),false);
 d.permissions.deleteReviews=true;assert.equal(canDeleteCustomerReview(d,'one'),true);assert.equal(canDeleteCustomerReview(d,'two'),false);
 assert.equal(canDeleteCustomerReview({...d,status:'disabled'},'one'),false);
 assert.equal(canReplyCustomerReview({...d,dealerApproved:false},'one'),false);
 assert.equal(canDeleteCustomerReview({id:'a',role:'admin',companyId:'dealer_topavto'} as any,'one'),false);
});
test('review listing scopes tenants, strips private fields and includes every company for platform readers',async()=>{
 const state:any={actor:{id:'d',role:'dealer',companyId:'one',dealerApproved:true}};(globalThis as any).__reviews=state;
 const mocks:Record<string,string>={
 '@/lib/auth':'export const getCurrentUser=async()=>globalThis.__reviews.actor;',
 '@/lib/dealers/showcase-store':'export const findDealer=async id=>({id,name:id,status:"verified"});',
 '@/lib/data':'export const readDataJson=async()=>[{id:"one",name:"One"},{id:"two",name:"Two"}];export const readChunkedDataJson=async path=>[{id:"a".repeat(64),dealerId:path.split("/")[1],status:"published",author:"Покупатель",userId:"PRIVATE",text:"Отзыв",rating:4,createdAt:"2026-10-06",reply:{text:"Ответ",authorId:"PRIVATE",createdAt:"2026-10-06"}}];'
 };
 try{const r=await build({entryPoints:['apps/web/app/api/crm/reviews/route.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,plugins:[{name:'mock',setup(b){b.onResolve({filter:/^@\//},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'ts'}));}}]});const m={exports:{} as any};new Function('require','module','exports',r.outputFiles[0].text)(require,m,m.exports);
 const get=(query='')=>m.exports.GET(new Request('https://avtocena.com/api/crm/reviews'+query));
 assert.equal((await get('?dealerId=two')).status,403);let d=await(await get()).json();assert.equal(d.total,1);assert.equal(d.items[0].dealerId,'one');assert.equal(d.items[0].canReply,false);assert.equal(JSON.stringify(d).includes('PRIVATE'),false);
 state.actor={id:'m',role:'manager',companyId:'dealer_topavto'};d=await(await get()).json();assert.equal(d.total,3);assert.equal(d.items[0].canDelete,false);
 state.actor=null;assert.equal((await get()).status,401);
 }finally{delete (globalThis as any).__reviews;}
});
