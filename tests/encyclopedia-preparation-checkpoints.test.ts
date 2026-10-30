import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareWithCheckpoints} from '../scripts/encyclopedia/preparation-checkpoints.mjs';
const rows = Array.from({length: 6}, (_, id) => ({id: String(id), revision: 'v1', key: `revisions/${id}/v1.json`}));
function fixture() {
 const objects = new Map<string, any>();
 return {objects, storage: {
  async readJson(key: string) {return objects.has(key) ? structuredClone(objects.get(key)) : null;},
  async writeJson(key: string, value: any) {objects.set(key, structuredClone(value));},
 }};
}
test('a failed preparation resumes completed immutable batches and retains exact row order', async () => {
 const {storage,objects} = fixture(); const calls: string[] = [];
 const options = {storage, rows, context: {source:'code1',year:2026}, batchSize:2, concurrency:1};
 await assert.rejects(prepareWithCheckpoints({...options, compile: async (row: any) => {
  calls.push(row.id); if(row.id === '4') throw Error('storage timeout'); return {id: row.id};
 }}), /storage timeout/);
 assert.equal(objects.size,2, 'only fully completed batches may be reused');
 calls.length = 0;
 const result = await prepareWithCheckpoints({...options, compile: async (row: any) => {calls.push(row.id);return {id:row.id};}});
 assert.deepEqual(calls,['4','5']); assert.deepEqual(result,rows.map(row => ({id:row.id})));
});
test('compiler/year changes invalidate checkpoints and revision changes invalidate their batch', async () => {
 const {storage} = fixture(); let calls = 0;
 const options = {storage,rows,context:{source:'a',year:2026},batchSize:2,concurrency:2,compile:async(row:any)=>{calls++;return {id:row.id,revision:row.revision};}};
 await prepareWithCheckpoints(options);assert.equal(calls,6);
 await prepareWithCheckpoints(options);assert.equal(calls,6);
 await prepareWithCheckpoints({...options,rows:rows.map((r,i)=>i===0?{...r,revision:'v2',key:'revisions/0/v2.json'}:r)});assert.equal(calls,8);
 await prepareWithCheckpoints({...options,context:{source:'b',year:2026}});assert.equal(calls,14);
 await prepareWithCheckpoints({...options,context:{source:'b',year:2027}});assert.equal(calls,20);
});
test('corrupt or incomplete checkpoints fail closed', async () => {
 const {storage,objects} = fixture();const options={storage,rows,context:'a',batchSize:2,concurrency:1,compile:async(row:any)=>({id:row.id})};
 await prepareWithCheckpoints(options);
 const key=[...objects.keys()][0];const saved=objects.get(key);saved.items[0].id='wrong';
 await assert.rejects(prepareWithCheckpoints(options),/checkpoint_invalid/);
});
test('failed writes cannot become successful partial preparation', async () => {
 const {storage} = fixture();storage.writeJson=async()=>{throw Error('storage write failed');};
 await assert.rejects(prepareWithCheckpoints({storage,rows,context:'a',batchSize:2,concurrency:1,compile:async()=>({})}),/storage write failed/);
});
test('concurrent identical checkpoint write is verified by readback', async () => {
 const {storage,objects} = fixture();storage.writeJson=async(key,value)=>{objects.set(key,structuredClone(value));throw Error('object_storage_PUT_412:PreconditionFailed:');};
 const result=await prepareWithCheckpoints({storage,rows,context:'a',batchSize:2,concurrency:1,compile:async(row:any)=>({id:row.id})});
 assert.deepEqual(result,rows.map(row=>({id:row.id})));
});
test('preparation bounds active work and never reorders results by completion',async()=>{
 const {storage}=fixture();let active=0,peak=0;
 const result=await prepareWithCheckpoints({storage,rows,context:'a',batchSize:1,concurrency:2,compile:async(row:any)=>{
  active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));active--;return row.id;
 }});
 assert.equal(peak,2);assert.deepEqual(result,rows.map(row=>row.id));
});
