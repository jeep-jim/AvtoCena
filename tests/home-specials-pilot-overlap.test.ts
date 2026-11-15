import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import fs from 'node:fs';
const require=createRequire(import.meta.url);
async function fixture(deps:any){
 const source=fs.readFileSync('apps/web/lib/dealers/public-showcase.ts','utf8');
 const implementation=source.slice(source.indexOf('export async function homeSpecialRail('));
 const {outputFiles}=await build({stdin:{contents:implementation,loader:'ts'},bundle:false,platform:'node',format:'cjs',write:false});
 const module={exports:{} as any};
 new Function('readDealers','readShowcase','availableShowcase','PILOT_DEALER_ID','selectCityShowcases','withDealerRate','publicRail','module','exports',outputFiles[0].text)(deps.readDealers,deps.readShowcase,deps.availableShowcase,'dealer_topavto',deps.selectCityShowcases,deps.withDealerRate,deps.publicRail,module,module.exports);
 return module.exports.homeSpecialRail;
}
test('other verified profiles and access checks proceed while pilot is pending',async()=>{
 const events:string[]=[],pilot={dealerId:'dealer_topavto',specialsEnabled:true,specialHeading:'Pilot'},peer={dealerId:'peer',profileEnabled:true,specialsEnabled:true};
 let release!:(x:any)=>void;const held=new Promise<any>(r=>release=r);
 const run=await fixture({readDealers:async()=>[{id:'dealer_topavto',status:'verified'},{id:'peer',status:'verified'},{id:'unverified',status:'pending'},{id:'hidden',status:'verified'}],readShowcase:async(id:string)=>{events.push('read:'+id);return id==='peer'?peer:{dealerId:id,profileEnabled:false};},availableShowcase:async(s:any)=>{events.push('access:'+s.dealerId);return s;},selectCityShowcases:(rows:any[],city:string)=>{assert.equal(city,'Москва');return rows;},withDealerRate:async(s:any)=>({...s,priced:true}),publicRail:(s:any,city:string,scope:string)=>{assert.equal(s.priced,true);assert.equal(city,'Москва');assert.equal(scope,'home');return [{id:s.dealerId}];}});
 let complete=false;const pending=run('Москва',held).then((x:any)=>{complete=true;return x;});await new Promise(r=>setImmediate(r));
 assert.deepEqual(events,['read:peer','read:hidden','access:peer','access:hidden']);assert.equal(complete,false);
 release(pilot);assert.deepEqual(await pending,{heading:'Предложения дилеров',items:[{id:'dealer_topavto'},{id:'peer'}]});
});
test('plain/null pilots and city admission preserve heading and exact returned items',async()=>{
 const pilot={dealerId:'dealer_topavto',specialHeading:'Exact',specialsEnabled:true};
 const run=await fixture({readDealers:async()=>[],readShowcase:async()=>{throw Error('unexpected');},availableShowcase:async()=>{throw Error('unexpected');},selectCityShowcases:(rows:any[],city:string)=>city==='other'?[]:rows,withDealerRate:async(x:any)=>x,publicRail:(x:any)=>[{id:x.dealerId,totalRub:123}]});
 assert.deepEqual(await run('local',pilot),{heading:'Exact',items:[{id:'dealer_topavto',totalRub:123}]});
 assert.deepEqual(await run('other',Promise.resolve(pilot)),{heading:'Предложения дилеров',items:[]});
 assert.deepEqual(await run('local',null),{heading:'Предложения дилеров',items:[]});
});
