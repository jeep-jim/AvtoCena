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

test("field-audit checkpoint remains no-write and does not silently promote candidates", () => {
  assert.equal(fieldAuditSummary.productionWrites, false);
  assert.equal(fieldAuditSummary.classificationMutations, false);
  assert.equal(fieldAuditSummary.publishAllowedMutations, false);
  assert.equal(fieldAuditSummary.rawBodiesStored, false);
  assert.equal(fieldAuditSummary.sourceCount, 4);
  assert.equal(fieldAuditSummary.sampleCount, 8);
  assert.equal(fieldAuditSummary.allClassificationsDeferred, true);
  assert.equal(fieldAuditSummary.allPublishAllowedRemainFalse, true);

  for (const sourceId of auditedSourceIds) {
    const candidate = ledger.candidates.find((row: any) => row.sourceId === sourceId);
    assert.ok(candidate, `missing candidate ${sourceId}`);
    assert.equal(candidate.class, "research_pending");
    assert.equal(candidate.publishAllowed, false);
    assert.match(candidate.evidence, /field audit run 33731051049/);
  }

  assert.match(fieldAuditEvidence, /classificationDecision=deferred/);
  assert.match(fieldAuditEvidence, /Bobaedream/);
  assert.match(fieldAuditEvidence, /CarSwitch/);
  assert.match(fieldAuditEvidence, /CARS24 UAE/);
  assert.match(fieldAuditEvidence, /DubiCars/);
});
