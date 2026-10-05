import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {canReplyCustomerReview} from '../apps/web/lib/account/review-moderation';
const require=createRequire(import.meta.url);
test('review reply belongs to the verified dealer or platform owner/administrator',()=>{
 const dealer:any={id:'d',role:'dealer',companyId:'dealer',dealerApproved:true};
 assert.equal(canReplyCustomerReview(dealer,'dealer'),true);
 for(const actor of [null,{...dealer,companyId:'other'},{...dealer,status:'disabled'},{...dealer,dealerApproved:false},{id:'m',role:'manager',companyId:'dealer_topavto'}])assert.equal(canReplyCustomerReview(actor as any,'dealer'),false);
 for(const role of ['owner','admin'])assert.equal(canReplyCustomerReview({id:'a',role,companyId:'dealer_topavto'} as any,'dealer'),true);
});
test('reply endpoint enforces tenant, origin and publication and public DTO hides private author IDs',async()=>{
 const state:any={actor:null,review:{id:'a'.repeat(64),userId:'private-customer',dealerId:'dealer',status:'published',rating:4.2,text:'Отзыв клиента',createdAt:'2026-10-05T00:00:00Z'},writes:0,dealerStatus:'verified'};(globalThis as any).__reply=state;
 const mocks:Record<string,string>={
 '@/lib/auth':'export const getCurrentUser=async()=>globalThis.__reply.actor;',
 '@/lib/dealers/showcase-store':'export const readShowcase=async()=>({profileEnabled:true});export const findDealer=async()=>({status:globalThis.__reply.dealerStatus});',
 '@/lib/data':'export const readChunkedDataJson=async()=>[globalThis.__reply.review];export const updateChunkedDataJson=async(p,id,fn)=>{const s=globalThis.__reply;if(s.review.id!==id)return null;const next=fn(s.review);s.writes++;return s.review=next;};'
 };
 try{const result=await build({entryPoints:['apps/web/app/api/dealers/[id]/reviews/route.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,plugins:[{name:'mocks',setup(b){b.onResolve({filter:/^@\//},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'ts'}));}}]});const module={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
 const context={params:Promise.resolve({id:'dealer'})};const post=(text='Спасибо за отзыв!',origin='https://avtocena.com')=>module.exports.POST(new Request('https://avtocena.com/api/dealers/dealer/reviews',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({reviewId:state.review.id,text})}),context);
 assert.equal((await post()).status,403);state.actor={id:'d',role:'dealer',dealerApproved:true,companyId:'other'};assert.equal((await post()).status,403);state.actor.companyId='dealer';assert.equal((await post('Спасибо','https://evil.example')).status,403);assert.equal((await post('  ')).status,400);assert.equal(state.writes,0);
 assert.equal((await post()).status,200);assert.equal(state.review.reply.authorId,'d');assert.equal(state.review.text,'Отзыв клиента');assert.equal(state.review.rating,4.2);
 const output=await (await module.exports.GET(new Request('https://avtocena.com'),context)).json();assert.equal(output.items[0].reply.text,'Спасибо за отзыв!');assert.equal(JSON.stringify(output).includes('private-customer'),false);assert.equal('authorId' in output.items[0].reply,false);assert.match(output.items[0].avatarUrl,/reviews\/[a-f0-9]{64}\/avatar$/);
 state.review.status='hidden';assert.equal((await post()).status,400);state.review.status='published';state.dealerStatus='disabled';assert.equal((await post()).status,403);assert.equal(state.writes,1);
 }finally{delete (globalThis as any).__reply;}
});
test('public review avatar exposes only a published review author image, never account fields',async()=>{
 const state:any={status:'published',profileEnabled:true,account:{id:'b'.repeat(64),avatarVersion:'v',phone:'private-phone',passwordHash:'private-hash'},reads:0};(globalThis as any).__publicAvatar=state;
 const mocks:Record<string,string>={
 '@/lib/dealers/showcase-store':'export const readShowcase=async()=>({profileEnabled:globalThis.__publicAvatar.profileEnabled});export const findDealer=async()=>({status:"verified"});',
 '@/lib/account/auth':'export const accountPath=id=>"accounts/"+id;',
 '@/lib/data':'export const readChunkedDataJson=async()=>[{id:"a".repeat(64),dealerId:"dealer",userId:"b".repeat(64),status:globalThis.__publicAvatar.status}];export const readDataJson=async()=>globalThis.__publicAvatar.account;export const getJsonStorage=()=>({getBinary:async()=>{globalThis.__publicAvatar.reads++;return {data:new Uint8Array([1,2,3])};}});'
 };
 try{const result=await build({entryPoints:['apps/web/app/api/dealers/[id]/reviews/[reviewId]/avatar/route.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,plugins:[{name:'mocks',setup(b){b.onResolve({filter:/^@\//},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'ts'}));}}]});const module={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
 const get=(id='a'.repeat(64))=>module.exports.GET(new Request('https://avtocena.com'),{params:Promise.resolve({id:'dealer',reviewId:id})});
 let r=await get();assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/webp');assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[1,2,3]);assert.equal((await get('c'.repeat(64))).status,404);state.status='hidden';assert.equal((await get()).status,404);assert.equal(state.reads,1);state.status='published';state.profileEnabled=false;assert.equal((await get()).status,404);state.profileEnabled=true;state.account.avatarVersion=undefined;state.account.avatarId='character-1';r=await get();assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/avatars/customers/character-1.svg');
 }finally{delete (globalThis as any).__publicAvatar;}
});
