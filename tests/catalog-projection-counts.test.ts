import test from 'node:test';
import assert from 'node:assert/strict';
import {countProjectionBatches} from '../scripts/lib/catalog-projection-counts.mjs';

test('audit counts a large stream without retaining vehicle records', async()=>{
  async function* batches() {
    for(let chunk=0;chunk<1000;chunk++)yield {generationId:'gen',items:Array.from({length:1000},(_,i)=>({id:chunk*1000+i,market:i%2?'china':'korea'}))};
  }
  assert.deepEqual(await countProjectionBatches(batches()),{generationId:'gen',count:1_000_000,markets:{china:500_000,korea:500_000}});
});
test('audit preserves empty generation identity and rejects mixed generations', async()=>{
  assert.deepEqual(await countProjectionBatches([{generationId:'empty',items:[]}]),{generationId:'empty',count:0,markets:{}});
  await assert.rejects(countProjectionBatches([{generationId:'a',items:[]},{generationId:'b',items:[]}]),/generation_changed/);
  await assert.rejects(countProjectionBatches([{generationId:'a',items:[{}]}]),/market_missing/);
});
