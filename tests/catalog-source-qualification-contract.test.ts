import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const ledger = JSON.parse(
  fs.readFileSync(new URL("data/catalog/source-qualification-v1.json", root), "utf8"),
);
const contract = fs.readFileSync(
  new URL("docs/catalog-source-qualification-v1.md", root),
  "utf8",
);
const roadmap = fs.readFileSync(new URL("roadmap.md", root), "utf8");
const fieldAuditSummary = JSON.parse(
  fs.readFileSync(new URL("data/catalog/source-field-audit-v1-summary.json", root), "utf8"),
);
const fieldAuditEvidence = fs.readFileSync(
  new URL("docs/catalog-source-field-audit-v1-evidence.md", root),
  "utf8",
);
const gapReconSummary = JSON.parse(
  fs.readFileSync(new URL("data/catalog/source-gap-recon-v1-summary.json", root), "utf8"),
);
const gapReconEvidence = fs.readFileSync(
  new URL("docs/catalog-source-gap-recon-v1-evidence.md", root),
  "utf8",
);

const markets = ["korea", "china", "japan", "uae", "europe", "georgia"];
const classes = new Set(["research_pending", "exact_catalog", "lead_only", "rejected"]);
const auditedSourceIds = [
  "bobaedream_korea_candidate",
  "dubicars_uae_exact",
  "carswitch_uae_candidate",
  "cars24_uae_candidate",
];

test("source-discovery ledger preserves all six markets and is no-write", () => {
  assert.deepEqual(ledger.markets, markets);
  assert.equal(ledger.productionWrites, false);
  for (const market of markets) {
    assert.ok(ledger.candidates.some((row: any) => row.market === market));
  }
});

test("existing sources are candidates, not grandfathered into publication", () => {
  assert.equal(new Set(ledger.candidates.map((row: any) => row.sourceId)).size, ledger.candidates.length);
  for (const row of ledger.candidates) {
    assert.ok(classes.has(row.class));
    assert.equal(row.publishAllowed, false);
    assert.match(row.url, /^https:\/\//);
    assert.ok(String(row.evidence || "").length >= 12);
  }
});

test("qualification contract requires both source-level and offer-level proof", () => {
  assert.match(contract, /Квалификация площадки не означает автоматического доверия/);
  assert.match(contract, /Offer-level exact gate/);
  assert.match(contract, /не удаляют и не пишут в production Object Storage/);
  assert.match(roadmap, /Новый курс: квалификация источников для шести рынков/);
  assert.match(roadmap, /Не продолжать бесконечное точечное лечение прежних площадок/);
});

test("field-audit checkpoint remains preserved as an immutable no-write evidence layer", () => {
  assert.equal(fieldAuditSummary.productionWrites, false);
  assert.equal(fieldAuditSummary.classificationMutations, false);
  assert.equal(fieldAuditSummary.publishAllowedMutations, false);
  assert.equal(fieldAuditSummary.rawBodiesStored, false);
  assert.equal(fieldAuditSummary.sourceCount, 4);
  assert.equal(fieldAuditSummary.sampleCount, 8);
  assert.equal(fieldAuditSummary.allClassificationsDeferred, true);
  assert.equal(fieldAuditSummary.allPublishAllowedRemainFalse, true);
  assert.match(fieldAuditEvidence, /classificationDecision=deferred/);
});

test("targeted gap checkpoint closes only source-bound evidence and still cannot promote candidates", () => {
  assert.equal(gapReconSummary.productionWrites, false);
  assert.equal(gapReconSummary.classificationMutations, false);
  assert.equal(gapReconSummary.publishAllowedMutations, false);
  assert.equal(gapReconSummary.rawBodiesStored, false);
  assert.equal(gapReconSummary.requestMethod, "GET_only");
  assert.equal(gapReconSummary.challengeBypass, false);
  assert.equal(gapReconSummary.robotsBypass, false);
  assert.equal(gapReconSummary.sampleCount, 8);
  assert.equal(gapReconSummary.allClassificationsDeferred, true);
  assert.equal(gapReconSummary.allPublishAllowedRemainFalse, true);

  const sourceMap = new Map(gapReconSummary.sources.map((row: any) => [row.sourceId, row]));
  assert.deepEqual(sourceMap.get("bobaedream_korea_candidate")?.remainingDeficitCounts, { body: 2 });
  assert.deepEqual(sourceMap.get("carswitch_uae_candidate")?.remainingDeficitCounts, { powerHp: 2 });
  assert.deepEqual(sourceMap.get("cars24_uae_candidate")?.remainingDeficitCounts, { powerHp: 2 });
  assert.deepEqual(sourceMap.get("dubicars_uae_exact")?.remainingDeficitCounts, { powerHp: 1, certifiedPower: 1 });

  for (const sourceId of auditedSourceIds) {
    const candidate = ledger.candidates.find((row: any) => row.sourceId === sourceId);
    assert.ok(candidate, `missing candidate ${sourceId}`);
    assert.equal(candidate.class, "research_pending");
    assert.equal(candidate.publishAllowed, false);
    assert.match(candidate.evidence, /gap recon run 33733192143/);
  }

  assert.match(gapReconEvidence, /Ни один источник ещё не получает `exact_catalog`/);
  assert.match(gapReconEvidence, /Bobaedream/);
  assert.match(gapReconEvidence, /CarSwitch/);
  assert.match(gapReconEvidence, /CARS24 UAE/);
  assert.match(gapReconEvidence, /DubiCars/);
});
