import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshOutcome} from '../scripts/lib/catalog-refresh-outcome.mjs';
const now='2026-09-25T04:00:00Z';
const complete={completedAt:now,sources:[{sourceId:'a',stopReason:'source_finished'}]};
const previous={version:2,lastPublicationSuccess:'2026-09-20',lastCollectionSuccess:'2026-09-19',generationId:'old',publishedCount:701};
test('finishing a continuation does not claim the entire source was freshly traversed',()=>{
 const r=refreshOutcome({market:'china',previous,now,intake:{...complete,sources:[{sourceId:'a',stopReason:'source_finished',initialCursor:'2001'}]},publication:{published:true,generationId:'new'}});
 assert.equal(r.collectionComplete,false);assert.equal(r.lastCollectionSuccess,previous.lastCollectionSuccess);
});
test('partial publication does not pretend collection succeeded',()=>{
 const r=refreshOutcome({market:'uae',previous,now,intake:{...complete,sources:[{sourceId:'a',stopReason:'blocked'}]},publication:{published:true,generationId:'new',publishedMarketCount:701}});
 assert.equal(r.lastCollectionSuccess,previous.lastCollectionSuccess);assert.equal(r.lastPublicationSuccess,now);assert.equal(r.collectionComplete,false);assert.equal(r.partialSources[0].reason,'blocked');
});
test('failed publication records fresh collection and preserves committed generation',()=>{
 const r=refreshOutcome({market:'europe',previous,now,intake:complete,publication:{published:false,publicationError:'guard'}});
 assert.equal(r.lastCollectionSuccess,now);assert.equal(r.lastPublicationSuccess,previous.lastPublicationSuccess);assert.equal(r.generationId,'old');assert.equal(r.publicationError,'guard');assert.equal(r.publicationStatus,'failed');
});
test('legacy partial-success timestamp is not promoted to complete',()=>{
 const r=refreshOutcome({market:'uae',previous:{...previous,version:1,qualityStatus:'partial'},now,intake:null,publication:null});
 assert.equal(r.lastCollectionSuccess,null);assert.equal(r.collectionComplete,false);assert.equal(r.publicationError,'publication_report_missing');
});

const paidSource={sourceId:'autohome_used_china_open',provider:'auto_api_che168',stopReason:'source_finished',
 initialCursor:11989266,cursor:11991886,rejectedIdentity:0,observations:170253,completeInventory:true,
 snapshotBinding:'a'.repeat(64),replica:{binding:'a'.repeat(64),cursor:11991886,key:'catalog/provider-replicas/che168/12345678-1234-1234-1234-123456789abc',sha256:'b'.repeat(64)}};
const paid={provider:'auto_api_che168',market:'china',completed:true,completedAt:now,sources:[paidSource]};
test('complete paid snapshot plus contiguous changes is complete despite a nonzero starting cursor',()=>{
 const r=refreshOutcome({market:'china',now,intake:paid,publication:{published:true,generationId:'new'},requiredSourceIds:[paidSource.sourceId]});
 assert.equal(r.collectionComplete,true);assert.equal(r.lastCollectionSuccess,now);
});
test('legacy Autohome partial state remains visible without making completed paid feed incomplete',()=>{
 const r=refreshOutcome({market:'china',now,intake:{...paid,sources:[paidSource,{sourceId:'autohome_new_china_open',stopReason:'budget_mid_page'}]},publication:{published:true,generationId:'new'},requiredSourceIds:[paidSource.sourceId]});
 assert.equal(r.collectionComplete,true);assert.deepEqual(r.partialSources,[]);
 assert.equal(r.supplementalPartialSources[0].reason,'budget_mid_page');assert.equal(r.sources[1].required,false);
});
test('paid completeness still rejects failed streams, missing sources and inconsistent replicas',()=>{
 for(const bad of [{...paid,completed:false},{...paid,failure:'stream_failed'},{...paid,sources:[]},{...paid,sources:[{...paidSource,replica:{...paidSource.replica,cursor:1}}]}]){
  assert.equal(refreshOutcome({market:'china',now,intake:bad,publication:{published:true,generationId:'new'},requiredSourceIds:[paidSource.sourceId]}).collectionComplete,false);
 }
});

test('verification requires active generation, matching count and the published replica cursor',async()=>{
 const {verifyChe168Publication}=await import('../scripts/lib/che168-publication-verification.mjs');
 const args={runId:'42',publication:{market:'china',published:true,generationId:'new',publishedMarketCount:139994},
  manifest:{generationId:'new',markets:{china:{count:139994}}},
  outcome:{market:'china',runId:'42',publicationStatus:'published',generationId:'new',lastCollectionAttempt:now,sources:[paidSource]},
  checkpoint:{version:1,market:'china',generationId:'new',sources:[paidSource]}};
 assert.equal(verifyChe168Publication(args).summary.cursor,11991886);
 for(const patch of [{manifest:{...args.manifest,generationId:'old'}},{publication:{...args.publication,published:false}},
   {manifest:{...args.manifest,markets:{china:{count:1}}}},{outcome:{...args.outcome,runId:'43'}},
   {checkpoint:{...args.checkpoint,sources:[{...paidSource,cursor:1}]}}])assert.throws(()=>verifyChe168Publication({...args,...patch}));
});
