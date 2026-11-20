import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreparedChinaModelView,selectPreparedChinaModelPage,type PreparedChinaModelPosition} from '../apps/web/lib/catalog/prepared-china-model-view';

const generation='gen_1795190399000_fixture',key='a'.repeat(64);

test('one model selects an inclusive price interval, stable ties and a deep page without reading skipped blocks',async()=>{
 const view=createPreparedChinaModelView(generation,key),stored=new Map<string,Buffer>(),reads:string[]=[];
 // 310 winning rows across five source chunks, large price groups crossing the
 // 64-slot boundaries, reversed insertion order. Other models are not posted.
 const all=Array.from({length:310},(_,i):PreparedChinaModelPosition=>({id:'offer-'+String(i).padStart(4,'0'),
  rub:2_000_000+Math.floor(i/40)*50_000,chunk:'chunk-'+String(1+Math.floor(i/64)).padStart(4,'0'),part:i%64,offset:i%16}));
 for(const row of [...all].reverse())view.add(row);
 const ref=await view.publish(async(path,body)=>{stored.set(path,body);});
 assert.equal(stored.size,6);
 const get=async(path:string)=>{reads.push(path);const value=stored.get(path);if(!value)throw Error('absent');return value;};
 const run=(input:Partial<Parameters<typeof selectPreparedChinaModelPage>[2]>={})=>selectPreparedChinaModelPage(generation,ref,
  {pageSize:24,start:0,countOnly:false,...input},get);
 const count=await run({countOnly:true});
 assert.deepEqual(count,{total:310,positions:[]});assert.equal(reads.length,1);
 reads.length=0;
 const lo=2_050_000,hi=2_250_000,expected=all.filter(row=>row.rub>=lo&&row.rub<=hi);
 assert.equal(expected.length,200);
 const filteredCount=await run({lower:lo,upper:hi,countOnly:true});
 assert.equal(filteredCount.total,expected.length);assert.ok(reads.length<=3);
 reads.length=0;
 const middle=await run({lower:lo,upper:hi,start:106,pageSize:35});
 assert.deepEqual(middle,{total:expected.length,positions:expected.slice(106,141)});
 assert.ok(!reads.some(path=>path.includes('/parts/4-')),'block after the upper limit was not read');
 reads.length=0;
 assert.deepEqual((await run({start:288})).positions,all.slice(288));
 assert.equal(reads.length,2,'header and tail only');
 assert.deepEqual(await run({lower:2_050_000,upper:2_050_000,start:19,pageSize:21}),{total:40,positions:all.slice(59,80)});
 assert.deepEqual(await run({start:310}),{total:310,positions:[]});
 assert.deepEqual(await run({lower:10_000_000,upper:100}),{total:0,positions:[]});
 assert.deepEqual(await run({lower:2_049_999.5,upper:2_050_000.5,countOnly:true}),{total:40,positions:[]});
 const untouched=[...stored.keys()].find(path=>path.includes('/parts/1-'))!,original=stored.get(untouched)!;
 stored.set(untouched,Buffer.from('{}'));
 assert.deepEqual((await run({start:288})).positions,all.slice(288));
 await assert.rejects(run({start:64}),/model:integrity/);
 stored.set(untouched,original);
 await assert.rejects(selectPreparedChinaModelPage('gen_1795190399000_other',ref,{start:0,pageSize:24,countOnly:true},get),/absent/);
});
