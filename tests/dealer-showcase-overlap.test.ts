import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync('apps/web/lib/dealers/showcase-store.ts','utf8');
const body=source.slice(source.indexOf('export const readShowcase ='),source.indexOf('export class ShowcaseConflict')).replace('export const readShowcase =','const readShowcase =').replace('async (id: string)','async (id)').replace('readDataJson<DealerShowcase | typeof missing>','readDataJson');
const turn=()=>new Promise<void>(r=>setImmediate(r));
function fixture(find:(id:string)=>Promise<any>,read:(path:string,fallback:any)=>Promise<any>){
 const base={pricing:{distancePricing:true,tariffs:[],usdRub:90},offers:[],name:'Default'};
 const run=new Function('requestCache','validDealerId','findDealer','readDataJson','defaultShowcase','PILOT_DEALER_ID',body+';return readShowcase;')((x:any)=>x,(id:string)=>/^[a-zA-Z0-9_-]{1,80}$/.test(id)&&!id.includes('__'),find,read,(id:string,name:string)=>({...base,dealerId:id,name}), 'dealer_topavto');
 return {run,base};
}
test('directory and profile reads start together and retain the exact merged profile',async()=>{
 const events:string[]=[];let release!:()=>void;const held=new Promise<void>(r=>release=r);
 const stored={pricing:{usdRub:95,tariffs:[]},offers:[{id:'car'}],name:'Saved',version:7};
 const {run}=fixture(async()=>{events.push('directory');await held;return {name:'Directory'};},async()=>{events.push('profile');await held;return stored;});
 const pending=run('dealer_peer');await turn();assert.deepEqual(events,['directory','profile']);release();
 assert.deepEqual(await pending,{dealerId:'dealer_peer',name:'Saved',pricing:{distancePricing:true,tariffs:[],usdRub:95},offers:stored.offers,version:7});
});
test('invalid and missing directory identities never expose profile data',async()=>{
 let reads=0;const {run}=fixture(async()=>null,async()=>{reads++;throw Error('private_storage_error');});
 assert.equal(await run('../private'),null);assert.equal(reads,0);
 assert.equal(await run('unknown_dealer'),null);await turn();assert.equal(reads,1);
});
test('missing objects retain defaults; actual stored null and storage errors remain failures',async()=>{
 const missing=fixture(async()=>({name:'Directory'}),async(_p,fallback)=>fallback);
 assert.equal((await missing.run('dealer_peer')).name,'Directory');
 const corrupt=fixture(async()=>({name:'Directory'}),async()=>null);await assert.rejects(corrupt.run('dealer_peer'),TypeError);
 const unavailable=fixture(async()=>({name:'Directory'}),async()=>{throw Error('storage_unavailable');});await assert.rejects(unavailable.run('dealer_peer'),/storage_unavailable/);
});
