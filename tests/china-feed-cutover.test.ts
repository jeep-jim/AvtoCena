import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyChinaFeedCutover} from '../apps/web/lib/catalog/china-feed-cutover';
import {COLLECTION_CONTROLS_KEY} from '../apps/web/lib/catalog/collection-controls';
import {defaultCollectionControls} from '../apps/web/lib/catalog/collection-controls-schema';
function memory(enabled=true){
 const controls=defaultCollectionControls();controls.sources.ajes_china_feed.enabled=enabled;
 const rows=new Map<string,any>([[COLLECTION_CONTROLS_KEY,controls]]);
 const storage:any={readJson:async(k:string,f:any)=>structuredClone(rows.get(k)??f),readJsonWithMeta:async(k:string)=>({found:rows.has(k),value:structuredClone(rows.get(k)),etag:'1'}),writeJson:async(k:string,v:any)=>{rows.set(k,structuredClone(v));}};
 return {rows,storage};
}
test('cutover disables only legacy China and preserves later owner changes',async()=>{
 const {rows,storage}=memory();await applyChinaFeedCutover(storage);
 const state=rows.get(COLLECTION_CONTROLS_KEY);
 assert.equal(state.sources.che168_feed.enabled,false);
 assert.equal(state.sources.ajes_china_feed.enabled,true);
 assert.equal(state.sources.autohome_used_china_open.enabled,false);
 assert.equal(state.sources.autohome_new_china_open.enabled,false);
 assert.equal(state.history.length,1);
 state.sources.che168_feed.enabled=true;
 await applyChinaFeedCutover(storage);
 assert.equal(rows.get(COLLECTION_CONTROLS_KEY).sources.che168_feed.enabled,true);
});
test('disabled replacement prevents destructive cutover',async()=>{
 const {rows,storage}=memory(false);await assert.rejects(applyChinaFeedCutover(storage),/replacement_not_enabled/);
 assert.equal(rows.get(COLLECTION_CONTROLS_KEY).sources.che168_feed.enabled,true);
});
