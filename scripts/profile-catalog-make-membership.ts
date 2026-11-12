// Reproducible local CPU experiment, not a production route benchmark.
// node --import tsx --import ./tests/helpers/offline-fetch.mjs scripts/profile-catalog-make-membership.ts
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {catalogSearchProjectionMatches,compileCatalogMakeMembership} from '../apps/web/lib/catalog/storage';

const rows=Array.from({length:22_000},(_,i)=>({id:`synthetic-${i}`,market:'china',make:'Volkswagen',model:'Tiguan',year:2023} as any));
const results:{mode:string;wallMs:number;cpuMs:number;matched:number}[]=[];
for(let round=0;round<9;round++)for(const mode of round%2?['compiled','previous']:['previous','compiled']){
 const start=performance.now(),cpu=process.cpuUsage();
 const matches=mode==='compiled'?compileCatalogMakeMembership('Volkswagen'):(row:any)=>catalogSearchProjectionMatches(row,{make:'Volkswagen',model:undefined});
 const ids=rows.filter(matches).map(row=>row.id);
 const used=process.cpuUsage(cpu),wallMs=performance.now()-start;
 assert.deepEqual(ids,rows.map(row=>row.id));
 if(round>=2)results.push({mode,wallMs,cpuMs:(used.user+used.system)/1000,matched:ids.length});
}
const median=(values:number[])=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
console.log(JSON.stringify({scope:'local synthetic make-membership only; not production or whole-route latency',node:process.version,rows:rows.length,rounds:7,query:{make:'Volkswagen'},samples:results,median:Object.fromEntries(['previous','compiled'].map(mode=>[mode,{wallMs:median(results.filter(r=>r.mode===mode).map(r=>r.wallMs)),cpuMs:median(results.filter(r=>r.mode===mode).map(r=>r.cpuMs))}]))},null,2));
