import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogPublicationStatus} from '../scripts/lib/catalog-publication-status.mjs';
test('read-only status distinguishes staged objects from the committed public generation',async()=>{
 const now=Date.parse('2026-10-09T15:00:00Z'),old=`gen_${now-600000}_aaaaaaaa`,next=`gen_${now-60000}_bbbbbbbb`;
 const reads=[];
 const storage={readJson:async key=>{reads.push(key);return key.endsWith('import-lock.json')
  ?{operationType:'catalog_v3_publish_china',lockedUntil:new Date(now+60000).toISOString(),heartbeatAt:new Date(now-1000).toISOString()}
  :{generationId:old,markets:{china:{count:38603}}};},
  listObjects:async prefix=>prefix==='catalog/generations'?[{key:`${prefix}/${next}/offers/china/000001.json`,size:25,lastModified:new Date(now-500).toISOString()},
   {key:`${prefix}/${old}/indexes/market/china.json`,size:10,lastModified:new Date(now-600000).toISOString()}]
  :[{key:`${prefix}/autohome_used_china_open/${next}-000001.json`,size:30,lastModified:new Date(now-1000).toISOString()}]};
 const result=await catalogPublicationStatus(storage,now);
 assert.equal(result.activeGeneration,old);assert.equal(result.activeCounts.china,38603);assert.equal(result.writer.active,true);
 assert.equal(result.recentGenerations[0].generationId,next);assert.equal(result.recentGenerations[0].objects,2);
 assert.equal(result.recentGenerations[0].bytes,55);assert.deepEqual(result.recentGenerations[0].groups,{'offers/china':1,internal:1});
 assert.equal(reads.length,2);
 const empty=await catalogPublicationStatus({readJson:async()=>null,listObjects:async()=>[]},now);
 assert.equal(empty.writer.active,false);assert.deepEqual(empty.recentGenerations,[]);
});
