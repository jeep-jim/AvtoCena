import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {restoreProAuctionsPower,proAuctionsReportedVolume,proAuctionsHybridDraft} from '../apps/web/lib/catalog/proauctions-source-parameters';
import {safePublicPricing} from '../apps/web/lib/catalog/safe-public-pricing';
const fixture=()=>JSON.parse(fs.readFileSync('tests/fixtures/proauctions/published-corolla-cross.json','utf8'));
test('published Corolla Cross keeps its sourced 140 hp and prefills the reported volume without certifying it',()=>{
 const original=fixture(),before=JSON.stringify(original),row=safePublicPricing(restoreProAuctionsPower(original));
 assert.equal(row.powerHp,140);assert.equal(row.powerKw,103);assert.equal(proAuctionsReportedVolume(row),1800);
 assert.equal(row.engineCc,undefined);assert.equal(row.totalRub,null);assert.equal(JSON.stringify(original),before);
});
test('conflicting, unrelated or rejected source values are never restored',()=>{
 for(const change of [r=>r.operational.semanticEvidence.powerHp.status='conflict',r=>r.operational.sourceSpecifications.sourceOfferId='other',r=>r.powerHp=160,r=>r.operational.powerSanity={rejected:true}]){
  const row=fixture();change(row);assert.equal(restoreProAuctionsPower(row),row);
 }
 const row=fixture();row.operational.semanticEvidence.engineCc.status='conflict';assert.equal(proAuctionsReportedVolume(row),undefined);
});
test('saved imports repair source confidence before inventory normalization',async()=>{
 const {inventorySourceEvidence}=await import('../apps/web/lib/catalog/prepare-seller-inventory');
 const input=fixture(),row=inventorySourceEvidence(input);
 assert.equal(row.powerHp,140);assert.equal(row.powerDataConfidence,'source_exact');
 assert.equal(input.powerDataConfidence,'estimated');
});

test('a bound hybrid source table fills ICE power but never invents subtype or 30-minute power',()=>{
 const row=fixture();for(const g of row.operational.sourceSpecifications.groups)for(const i of g.items)if(i.name==='Мощность')i.name='Мощность ДВС';row.operational.sourceSpecifications.groups[0].items.push({name:'Гибрид',value:'да'});
 const before=JSON.stringify(row);const draft=proAuctionsHybridDraft(row);
 assert.equal(draft.fuel,'hybrid');assert.equal(draft.icePowerKw,'103');
 assert.equal('hybridKind' in draft,false);assert.equal('power30MinKw' in draft,false);
 assert.equal(JSON.stringify(row),before);
 row.operational.sourceSpecifications.sourceOfferId='different';assert.deepEqual(proAuctionsHybridDraft(row),{});
});
