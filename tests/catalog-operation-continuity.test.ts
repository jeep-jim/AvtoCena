import test from 'node:test';
import assert from 'node:assert/strict';
import {proAuctionsSchedule} from '../scripts/lib/proauctions-schedule.mjs';
import {staleJapanPreviewObjects} from '../scripts/lib/catalog-runtime-cleanup.mjs';
test('Japan resumes incomplete and failed publications, skips fresh success, refreshes after policy interval',()=>{
 const now=Date.parse('2026-09-19T03:00:00Z');
 const state={startedAt:new Date(now-86400000).toISOString(),complete:false};
 assert.equal(proAuctionsSchedule(null,now).due,true);
 assert.equal(proAuctionsSchedule(state,now).resume,true);
 assert.equal(proAuctionsSchedule({...state,complete:true},now).reason,'retry_publication');
 assert.equal(proAuctionsSchedule({...state,complete:true,published:true},now).due,false);
 assert.equal(proAuctionsSchedule({...state,complete:true,published:true},now+14*86400000).resume,false);
 assert.throws(()=>proAuctionsSchedule({startedAt:'bad'},now));
});
test('runtime cleanup protects live and fresh caches and excludes all unrelated paths',()=>{
 const old='gen_1000_a',live='gen_2000_b';
 const row=(generation,modified=1000)=>({key:`catalog/runtime/japan-preview-inputs-v1/${generation}.json`,lastModified:new Date(modified).toISOString()});
 const rows=[row(old),row(live),row('gen_4000_c'),row('gen_1100_d',4500),{key:'catalog/runtime/private.json',lastModified:new Date(1000).toISOString()}];
 assert.deepEqual(staleJapanPreviewObjects(rows,new Set([live]),3000),[rows[0]]);
});
test('durable checkpoints restore completed files and retain the previous archive',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const {saveProAuctionsState,restoreProAuctionsState,proAuctionsStateKey}=await import('../scripts/lib/proauctions-durable-state.mjs');
 const {getJsonStorage}=await import('../apps/web/lib/data');
 const cwd=process.cwd(),oldDriver=process.env.JSON_STORAGE_DRIVER,oldDurable=process.env.PROAUCTIONS_DURABLE;
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'avtocena-checkpoint-'));
 try{
 process.chdir(root);process.env.JSON_STORAGE_DRIVER='local';process.env.PROAUCTIONS_DURABLE='1';
 await fs.mkdir('data');await fs.mkdir('collection');
 const state={startedAt:new Date().toISOString(),complete:false,details:4,prepared:2};
 await fs.writeFile('collection/checkpoint.json',JSON.stringify(state));
 await saveProAuctionsState('collection',state,true);
 const first=await getJsonStorage().readJson(proAuctionsStateKey,null);
 await fs.writeFile('collection/example.json','{"value":42}');
 await saveProAuctionsState('collection',{...state,details:5},true);
 const second=await getJsonStorage().readJson(proAuctionsStateKey,null);
 assert.equal(second.previousKey,first.key);assert.notEqual(second.key,first.key);
 await restoreProAuctionsState('restored',second);
 assert.deepEqual(JSON.parse(await fs.readFile('restored/example.json','utf8')),{value:42});
 await assert.rejects(()=>restoreProAuctionsState('bad',{...second,checksum:'wrong'}),/checksum/);
 }finally{process.chdir(cwd);if(oldDriver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=oldDriver;if(oldDurable===undefined)delete process.env.PROAUCTIONS_DURABLE;else process.env.PROAUCTIONS_DURABLE=oldDurable;await fs.rm(root,{recursive:true,force:true});}
});
