import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const BASE='949f4f0c7e3cdea653651094c14a88b1446084b5';
const Q='data/catalog/source-qualification-v1.json', P='data/catalog/source-partial-classification-v1.json';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const before=p=>JSON.parse(execFileSync('git',['show',`${BASE}:${p}`],{encoding:'utf8',maxBuffer:2000000}));
const q=read(Q), p=read(P), oldQ=before(Q), oldP=before(P);
const sourceId='iautos_china_candidate';
for(const v of [q,p]) {
  assert.equal(v.productionWrites,false); assert.equal(v.publishAllowedMutations,false);
  assert(v.pausedMarkets.includes('japan')); assert.equal(v.marketControls.japan.automatedQualificationAllowed,false);
}
assert(q.candidates.every(c=>c.publishAllowed===false));
assert(p.decisions.every(c=>c.publishAllowed===false));
assert.deepEqual(q.candidates.filter(c=>c.sourceId!==sourceId),oldQ.candidates.filter(c=>c.sourceId!==sourceId));
assert.deepEqual(p.decisions.filter(c=>c.sourceId!==sourceId),oldP.decisions.filter(c=>c.sourceId!==sourceId));
assert.deepEqual(q.marketControls,oldQ.marketControls); assert.deepEqual(p.marketControls,oldP.marketControls);
assert(q.candidates.filter(c=>c.market==='japan').every(c=>c.qualificationPaused===true));
const candidate=q.candidates.find(c=>c.sourceId===sourceId), decision=p.decisions.find(c=>c.sourceId===sourceId);
assert.equal(candidate.class,'lead_only'); assert.equal(decision.class,'lead_only');
assert.deepEqual(decision.evidence,oldP.decisions.find(c=>c.sourceId===sourceId).evidence);
assert.deepEqual(candidate.accessPolicyEvidence,decision.accessPolicyEvidence);
assert.equal(candidate.accessPolicyEvidence.permissionProven,false);
const e=read(candidate.accessPolicyEvidence.evidenceFile);
assert.equal(e.requestCount,2); assert.equal(e.requestCount,e.requests.length);
assert.deepEqual(e.requests.map(r=>r.status),[200,200]); assert.equal(e.legalLinkCount,0);
assert.equal(e.requests[1].capturedBytes,51425); assert.equal(e.requests[1].truncated,false);
assert.equal(e.sourceId,sourceId); assert.equal(e.positivePermissionProven,false);
for(const k of ['productionWrites','publishAllowedMutations','objectStorageWrites','catalogGenerationWrites','manifestWrites','cleanupStarted','rawBodiesStored','redirectsFollowed']) assert.equal(e[k],false);
for(const k of ['listingRequests','detailRequests','apiRequests','paginationRequests','japanRequests']) assert.equal(e[k],0);
const baseRoadmap=execFileSync('git',['show',`${BASE}:roadmap.md`],{encoding:'utf8',maxBuffer:2000000});
const roadmap=fs.readFileSync('roadmap.md','utf8'); assert(roadmap.startsWith(baseRoadmap)); assert(roadmap.includes('## 40.52'));
const changedFiles=execFileSync('git',['diff','--name-only',BASE,'HEAD'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
const allowed=new Set([Q,P,'roadmap.md','data/catalog/source-access-policy-evidence/iautos-20260906.json',
  'scripts/catalog-source-chngoodcar-access-policy-probe-v1.mjs','scripts/catalog-source-iautos-access-policy-probe-v1.mjs',
  'scripts/catalog-source-iautos-access-policy-checkpoint-v1.mjs','.github/workflows/catalog-source-iautos-access-policy-probe-v1.yml']);
assert(changedFiles.every(f=>allowed.has(f)),'out_of_scope_mutation');
const result={version:1,checkedAt:new Date().toISOString(),baseSha:BASE,headSha:process.env.GITHUB_SHA||null,
  productionWrites:false,publishAllowedMutations:false,objectStorageWrites:false,catalogGenerationWrites:false,manifestWrites:false,
  cleanupStarted:false,sourceRequests:0,japanRequests:0,candidateCount:q.candidates.length,
  publishAllowedTrueCount:q.candidates.filter(c=>c.publishAllowed).length,changedFiles,
  appendOnlyRoadmap:true,unrelatedSourcesUnchanged:true,passed:true};
fs.writeFileSync('catalog-source-iautos-access-policy-checkpoint-v1.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
