import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {authorizePrivateAppendIntent,rehearsePrivateAppendIntent} from './private-append-intent.mjs';
const old='gen_1794878284419_base', next='gen_1795132800000_candidate';
const relative=Array.from({length:78},(_,i)=>'chunk-'+String(i+1).padStart(4,'0'));
const refs=relative.map(r=>'catalog/generations/'+old+'/offers/europe/'+r+'.json');
const json=x=>JSON.stringify(x);
const sha=x=>createHash('sha256').update(x).digest('hex');
const typed=x=>sha(x.map(r=>json(r)+'\n').join(''));
const market='europe',source='autoscout_europe_open',now=Date.parse('2026-11-20T16:00:00Z');
const stamp='2026-11-20T00:00:00Z';
const base=Buffer.from(json({version:2,generationId:old,markets:{europe:{count:38964,updatedAt:stamp,chunks:relative},korea:{count:4,chunks:['chunk-0001']}}}));
const both={id:'seller-only-fixture',market,catalogPricingMode:'seller',calculationStatus:'needs_data',sourceCurrency:'EUR',
 sourcePrice:1000,sellerPriceRub:90000,totalRub:null};
const full={...both,sourceId:source,status:'active'}, compact={...both,sourceGroup:source};
const dryCut={runId:42,additions:1,preservedOverlap:1,orderedIdsSha:typed([both.id]),orderedCompactRowsSha:typed([compact])};
const pricing={day:'2026-11-20',runtime:'fake_runtime',calculation:'fake_calc',cbrWireSha256:'fake_cbr_sha',eur:90};
const input={now,baseManifestBytes:base,nextId:next,fullChunks:[Buffer.from(json([full]))],nativeOwnCompactRows:[compact],admittedRowsWire:Buffer.from(json([full])),
 dryCut,pricing,retentionInputs:{mode:'retain_exact_inherited_public_reference_roots',inheritedRefSetSha256:sha(json(refs)),generationIdsSha256:sha(json([old]))}};
const p={runtime:pricing.runtime,calc:pricing.calculation,rateSha:pricing.cbrWireSha256,eur:pricing.eur,admittedFullRowsSha:sha(input.admittedRowsWire),admittedFullCount:1};
const fake={baseSha:sha(base),generation:old,originalCount:38964,originalChunks:78,limitAdditions:1510,cut:dryCut};
const run=(x=input)=>rehearsePrivateAppendIntent(x,p,fake);
test('private only intent protects all 78 original complete chunk references; outputs no bodies or global manifest',()=>{
 const intent=run();
 assert.equal(intent.kind,'europe-private-append-reference-intent-v1');assert.equal(intent.version,1);
 assert.deepEqual(intent.retainedOriginal.immutableRefs,refs);
 assert.deepEqual(intent.retainedOriginal.requiredGenerationIds,[old]);assert.equal(intent.boundCandidate.chunks.length,1);
 assert.equal(intent.futureEuropeOnlyDescriptor.count,38965);
 assert.equal(intent.publicationAuthorized,false);assert.equal(intent.stagedDataWritten,false);
 assert.equal(intent.physicalObjectRetentionVerified,false);assert.equal(intent.readyToActivate,false);
 assert.ok(!json(intent).includes(both.id));assert.ok(!Object.hasOwn(intent,'markets'));
 assert.throws(()=>authorizePrivateAppendIntent(input),/orphan_or_unapproved_pricing_context/);
});
test('one omitted retained key, stale FX, admitted hash drift, delivered price, foreign source, or wrong registered base fails',()=>{
 assert.throws(()=>run({...input,retentionInputs:{...input.retentionInputs,inheritedRefSetSha256:sha(json(refs.slice(1)))}}),/not_retained/);
 assert.throws(()=>run({...input,now:Date.parse('2026-11-21T00:00:00Z')}),/expired/);
 assert.throws(()=>run({...input,nativeOwnCompactRows:[{...compact,trim:'changed'}]}),/digest_drift/);
 assert.throws(()=>run({...input,nativeOwnCompactRows:[{...compact,totalRub:90000}]}),/no_delivered_claim/);
 assert.throws(()=>run({...input,fullChunks:[Buffer.from(json([{...full,sourceId:'mobile_de_open'}]))]}),/identity_order_or_source_drift/);
 assert.throws(()=>run({...input,fullChunks:[Buffer.from(json([{...full,images:[{id:'changed-photo'}]}]))]}),/full_body_or_card_drift/);
 assert.throws(()=>run({...input,admittedRowsWire:Buffer.from('[]')}),/unapproved_full_native/);
 assert.throws(()=>run({...input,baseManifestBytes:Buffer.concat([base,Buffer.from(' ')])}),/baseline_wire_commitment_drift/);
});
