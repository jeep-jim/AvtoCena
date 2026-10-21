import assert from 'node:assert/strict';
import test from 'node:test';
import { annotateResult, normalizeUnitContexts } from '../scripts/catalog-source-deficit-resolution-v1-postprocess.mjs';

test('normalizes thousands-separated cc and Korean horsepower from stored context',()=>{
  const out=normalizeUnitContexts({unitEvidence:{ccEvidence:[{value:359,unit:'cc',context:'배기량 2,359 cc (190마력)'}],engineLiterMatches:[],powerEvidence:[]}});
  assert.equal(out.ccEvidence[0].value,2359);
  assert.equal(out.powerEvidence[0].value,190);
});

test('does not close DubiCars gallery when window exceeds source image_count',()=>{
  const r:any={sourceId:'dubicars_uae_exact',offerId:'740206',first:{summary:{galleryProof:[{uniqueUnderlyingCount:17}],unitEvidence:{}}},second:{summary:{unitEvidence:{}}}};
  const prior:any={sources:[{sourceId:'dubicars_uae_exact',embeddedOfferEvidence:{'740206':{imageCount:11}}}]};
  annotateResult(r,prior);
  assert.equal(r.annotation.gallery.status,'contaminated_window');
});

test('CARS24 exact-candidate price requires visible and embedded offer evidence',()=>{
  const r:any={sourceId:'cars24_uae_candidate',offerId:'1',first:{summary:{priceEvidence:{visibleHits:[{}],embeddedContexts:['carDetails price']},unitEvidence:{engineLiterMatches:[{}]}}},second:{summary:{unitEvidence:{}}}};
  annotateResult(r,{sources:[]});
  assert.equal(r.annotation.offerPriceExactCandidate,true);
  assert.equal(r.annotation.engineLiterExplicit,true);
  assert.equal(r.annotation.exactEngineCc,false);
});
