import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshOutcome} from '../scripts/lib/catalog-refresh-outcome.mjs';
const now='2026-09-25T04:00:00Z';
const complete={completedAt:now,sources:[{sourceId:'a',stopReason:'source_finished'}]};
const previous={version:2,lastPublicationSuccess:'2026-09-20',lastCollectionSuccess:'2026-09-19',generationId:'old',publishedCount:701};
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
