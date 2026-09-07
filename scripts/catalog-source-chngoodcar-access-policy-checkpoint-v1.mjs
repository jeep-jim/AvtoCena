import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const BASE = 'c29236342681b7b0d02c76226597a745dd48a421';
const REGISTRY = 'data/catalog/source-qualification-v1.json';
const PARTIAL = 'data/catalog/source-partial-classification-v1.json';
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const old = p => JSON.parse(execFileSync('git', ['show', `${BASE}:${p}`], { encoding: 'utf8', maxBuffer: 2000000 }));
const q = read(REGISTRY), p = read(PARTIAL), beforeQ = old(REGISTRY), beforeP = old(PARTIAL);
const changedSources = new Set(['chngoodcar_china_candidate', 'automarket_uae_candidate']);
for (const v of [q, p]) {
  assert.equal(v.productionWrites, false);
  assert.equal(v.publishAllowedMutations, false);
  assert(v.pausedMarkets.includes('japan'));
  assert.equal(v.marketControls.japan.automatedQualificationAllowed, false);
}
assert(q.candidates.every(c => c.publishAllowed === false));
assert(p.decisions.every(c => c.publishAllowed === false));
assert.deepEqual(q.candidates.filter(c => !changedSources.has(c.sourceId)), beforeQ.candidates.filter(c => !changedSources.has(c.sourceId)));
assert.deepEqual(p.decisions.filter(c => !changedSources.has(c.sourceId)), beforeP.decisions.filter(c => !changedSources.has(c.sourceId)));
assert.deepEqual(q.marketControls, beforeQ.marketControls);
assert.deepEqual(p.marketControls, beforeP.marketControls);
assert(q.candidates.filter(c => c.market === 'japan').every(c => c.qualificationPaused === true));
const goodcar = q.candidates.find(c => c.sourceId === 'chngoodcar_china_candidate');
assert.equal(goodcar.class, 'lead_only');
assert.equal(goodcar.technicalQualification.class, 'exact_catalog');
assert.equal(goodcar.accessPolicy.permissionProven, false);
assert.equal(p.decisions.find(c => c.sourceId === goodcar.sourceId).class, goodcar.class);
assert.equal(q.candidates.find(c => c.sourceId === 'automarket_uae_candidate').class, 'research_pending');
const e = 'data/catalog/source-access-policy-evidence/';
const am = read(e + 'automarket-20260905.json');
const discovery = read(e + 'chngoodcar-20260906-discovery.json');
const confirmation = read(e + 'chngoodcar-20260906-confirmation.json');
assert.equal(am.requestCount, 2);
assert.equal(discovery.requestCount, 3);
assert.equal(confirmation.requestCount, 2);
assert.equal(confirmation.routeProvenanceRun, 34018339034);
assert.equal(confirmation.policy.explicitPriorWrittenApprovalClauseObserved, true);
assert(confirmation.policy.commercialUseClause.text.includes('事先书面批准'));
for (const report of [am, discovery, confirmation]) {
  for (const k of ['productionWrites', 'publishAllowedMutations', 'objectStorageWrites', 'catalogGenerationWrites', 'rawBodiesStored']) assert.equal(report[k], false);
  for (const k of ['detailRequests','paginationRequests','apiRequests']) assert.equal(report[k], 0);
}
const baseRoadmap = execFileSync('git', ['show', `${BASE}:roadmap.md`], { encoding: 'utf8', maxBuffer: 2000000 });
const roadmap = fs.readFileSync('roadmap.md', 'utf8');
assert(roadmap.startsWith(baseRoadmap), 'roadmap must be append-only');
assert(roadmap.includes('## 40.51') && /iAutos/.test(q.next));
const allowed = new Set([REGISTRY, PARTIAL, 'roadmap.md',
  'scripts/catalog-source-chngoodcar-access-policy-probe-v1.mjs',
  'scripts/catalog-source-chngoodcar-access-policy-checkpoint-v1.mjs',
  '.github/workflows/catalog-source-chngoodcar-access-policy-probe-v1.yml',
  e + 'automarket-20260905.json', e + 'chngoodcar-20260906-discovery.json', e + 'chngoodcar-20260906-confirmation.json']);
const changedFiles = execFileSync('git', ['diff', '--name-only', BASE, 'HEAD'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
assert(changedFiles.every(path => allowed.has(path)), `out-of-scope changes: ${changedFiles.filter(path => !allowed.has(path))}`);
const report = { version: 1, checkedAt: new Date().toISOString(), baseSha: BASE, headSha: process.env.GITHUB_SHA || null,
  productionWrites: false, publishAllowedMutations: false, objectStorageWrites: false,
  catalogGenerationWrites: false, manifestWrites: false, cleanupStarted: false, sourceRequests: 0, japanRequests: 0,
  candidateCount: q.candidates.length, publishAllowedTrueCount: q.candidates.filter(c => c.publishAllowed).length,
  classificationCounts: q.candidates.reduce((a, c) => (a[c.class] = (a[c.class] || 0) + 1, a), {}),
  changedFiles, appendOnlyRoadmap: true, unrelatedSourcesUnchanged: true, passed: true };
fs.writeFileSync('catalog-source-chngoodcar-access-policy-checkpoint-v1.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
