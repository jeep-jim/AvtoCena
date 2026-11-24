import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyChinaFeedCutover} from '../apps/web/lib/catalog/china-feed-cutover';
import {COLLECTION_CONTROLS_KEY} from '../apps/web/lib/catalog/collection-controls';
import {defaultCollectionControls} from '../apps/web/lib/catalog/collection-controls-schema';
const marker='catalog/operations/china-ajes-cutover-20261018.json';
function memory(legacyEnabled?:boolean){
 const controls=defaultCollectionControls();
 if(legacyEnabled!==undefined)controls.sources.ajes_china_feed={...controls.sources.ajes_japan_feed,enabled:legacyEnabled};
 const rows=new Map<string,any>([[COLLECTION_CONTROLS_KEY,controls]]);
 const reads:string[]=[],writes:string[]=[];
 const storage:any={readJson:async(k:string,f:any)=>{reads.push(k);return structuredClone(rows.get(k)??f);},readJsonWithMeta:async(k:string)=>{reads.push(k);return {found:rows.has(k),value:structuredClone(rows.get(k)),etag:'1'};},writeJson:async(k:string,v:any)=>{writes.push(k);rows.set(k,structuredClone(v));}};
 return {rows,storage,reads,writes};
}
test('retired AJ China cannot replace Che168 even with a legacy enabled flag',async()=>{
 for(const legacyEnabled of [undefined,false,true]){
  const {rows,storage,writes}=memory(legacyEnabled),before=structuredClone(rows);
  await assert.rejects(applyChinaFeedCutover(storage),/china_replacement_not_enabled/);
  assert.deepEqual(rows,before,'failed cutover preserves all source flags and history');
  assert.deepEqual(writes,[]);assert.equal(rows.has(marker),false);
  assert.equal(rows.get(COLLECTION_CONTROLS_KEY).sources.che168_feed.enabled,true);
 }
});
test('an existing cutover marker is a no-op and preserves later owner switches',async()=>{
 for(const enabled of [true,false]){
  const {rows,storage,reads,writes}=memory(true);
  rows.get(COLLECTION_CONTROLS_KEY).sources.che168_feed.enabled=enabled;
  rows.set(marker,{version:1,at:'2026-10-18T00:00:00.000Z',revision:1});
  const before=structuredClone(rows);await applyChinaFeedCutover(storage);
  assert.deepEqual(rows,before);assert.deepEqual(writes,[]);assert.deepEqual(reads,[marker]);
 }
});
