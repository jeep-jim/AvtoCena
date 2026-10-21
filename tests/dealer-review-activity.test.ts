import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('existing and new published reviews join the feed once, respecting assignment, deletion and pagination',async()=>{
 const state:any={reviews:[{id:'r1',leadId:'mine',dealerId:'dealer_topavto',status:'published',rating:4.2,author:'Анна',text:'Спасибо за автомобиль!',createdAt:'2026-10-05T12:00:00Z'},{id:'r2',leadId:'other',dealerId:'dealer_topavto',status:'published',rating:5,createdAt:'2026-10-05T13:00:00Z'},{id:'r3',leadId:'mine',dealerId:'dealer_topavto',status:'hidden',rating:1,createdAt:'2026-10-05T14:00:00Z'}]};(globalThis as any).__reviewFeed=state;
 try{const result=await build({entryPoints:['apps/web/lib/dealers/review-activity.ts'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'storage',setup(b){b.onResolve({filter:/^\.\.\/data$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const readDataJson=async()=>[{id:"dealer_topavto",name:"Top Avto"}];export const readRecentChunkedDataJson=async(p,n,f)=>globalThis.__reviewFeed.reviews.filter(f).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,n);',loader:'js'}));}}]});const module={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
 const load=(all=false,before='')=>module.exports.readReviewActivity([{id:'mine',dealerId:'dealer_topavto'},{id:'other',dealerId:'dealer_topavto'}],new Set(['mine']),all,30,before);
 let events=await load();assert.deepEqual(events.map((e:any)=>e.id),['review:r1']);assert.equal(events[0].title,'Новый отзыв · 4.2 ★');assert.equal(events[0].text,'Спасибо за автомобиль!');assert.equal(events[0].href,'/dealers/dealer_topavto#reviews');assert.equal((await load(true)).length,2);assert.equal((await load(true,'2026-10-05T12:30:00Z')).length,1);assert.deepEqual(await load(false,'2026-10-05T12:00:00Z'),[]);
 state.reviews[0].status='hidden';assert.deepEqual(await load(),[]);
 }finally{delete (globalThis as any).__reviewFeed;}
});
