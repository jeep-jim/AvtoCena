import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const script = "scripts/catalog-apply-targeted-detail-delta.mjs";
const capturedAt = "2026-09-17T00:00:00.000Z";
const exact = (value: unknown) => ({ source: "dubicars_exact_detail", rawValues: [String(value)], status: "exact", value });
const missing = () => ({ source: "dubicars_source_missing", rawValues: [], status: "missing" });

function image(index: number) {
  return { id: "", url: `https://www.dubicars.com/images/car-${index}.jpg`, objectKey: "", size: 0, checksum: "", mimeType: "image/jpeg" };
}

function baseOffer() {
  return {
    id: "dubicars-offer-1000265", sourceId: "dubicars_uae_exact", sourceOfferId: "1000265", market: "uae",
    offerType: "fixed", status: "active", make: "Toyota", model: "Camry", year: 2024,
    fuel: undefined, powertrainKind: "unknown", engineCc: undefined, powerHp: undefined,
    sourcePrice: null, sourceCurrency: null, priceMode: "estimated", images: [], totalRub: null,
    calculationStatus: "needs_data", firstSeenAt: capturedAt, updatedAt: capturedAt,
    operational: {
      sourceUrl: "https://www.dubicars.com/2024-toyota-camry-1000265.html",
      detailIdentityVerified: false, fieldIdentityVerified: false, photoIdentityVerified: false, galleryVerified: false,
      semanticEvidence: { year: exact(2024), fuel: missing(), engineCc: missing(), powerHp: missing() }, raw: {},
    },
  } as any;
}

function enrichedOffer() {
  const offer = structuredClone(baseOffer());
  offer.fuel = "petrol"; offer.powertrainKind = "combustion"; offer.engineCc = 2494;
  offer.powerHp = 181; offer.powerKw = 133.1; offer.powerDataConfidence = "source_exact";
  offer.powerDataSource = "DubiCars exact detail:1000265:Horsepower";
  offer.sourcePrice = 145_000; offer.sourceCurrency = "AED"; offer.priceMode = "fixed";
  offer.images = [image(1), image(2), image(3)]; offer.updatedAt = "2026-09-17T02:00:00.000Z";
  offer.operational = {
    ...offer.operational,
    detailIdentityVerified: true, fieldIdentityVerified: true, photoIdentityVerified: true,
    galleryVerified: true, galleryImageCount: 3,
    semanticEvidence: { year: exact(2024), fuel: exact("petrol"), engineCc: exact(2494), powerHp: exact(181) },
    raw: { url: offer.operational.sourceUrl },
  };
  return offer;
}

function hash(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function runtimeArgs() {
  return process.execArgv.filter((arg) => arg !== "--test" && !arg.startsWith("--test-"));
}

test("the delta filter is offline and emits only a validated detail revision", async () => {
  const source = fs.readFileSync(script, "utf8");
  assert.doesNotMatch(source, /fetch\s*\(|fetchPage|catalog-publish|persistCatalog|ObjectJsonStorage/);

  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), "targeted-detail-delta-"));
  try {
    const baseDirectory = path.join(temporary, "catalog-intake-uae");
    await fsp.mkdir(baseDirectory, { recursive: true });
    await fsp.writeFile(path.join(baseDirectory, "report.json"), JSON.stringify({ market: "uae", mode: "source_observations", productionWrites: false }));
    const observation = { version: 1, stage: "listing", publicationReady: false, offer: baseOffer() };
    const baseFile = path.join(baseDirectory, "dubicars-000001.jsonl");
    const baseBytes = JSON.stringify(observation) + "\n";
    await fsp.writeFile(baseFile, baseBytes);
    const revisionHash = hash(observation);

    const queueFile = path.join(temporary, "queue.jsonl");
    const actionableNeeds = ["sourcePrice", "photos", "fuelPowertrain", "engineCc", "powerHp"];
    await fsp.writeFile(queueFile, JSON.stringify({
      version: 1, market: "uae", sourceId: observation.offer.sourceId, offerId: observation.offer.id,
      sourceOfferId: observation.offer.sourceOfferId, inputRevisionHash: revisionHash,
      sourceUrl: observation.offer.operational.sourceUrl, latestStage: "listing", needs: actionableNeeds,
      actionableNeeds, transport: "direct_fixed_id", runnable: true,
    }) + "\n");
    const candidatesFile = path.join(temporary, "candidates.jsonl");
    await fsp.writeFile(candidatesFile, JSON.stringify({
      version: 1, market: "uae", sourceId: observation.offer.sourceId, offerId: observation.offer.id,
      sourceOfferId: observation.offer.sourceOfferId, inputRevisionHash: revisionHash,
      requestedNeeds: actionableNeeds, outcome: "candidate", offer: enrichedOffer(),
    }) + "\n");
    const deltaFile = path.join(temporary, "delta.jsonl");
    const reportFile = path.join(temporary, "delta-report.json");
    const result = spawnSync(process.execPath, [...runtimeArgs(), script], {
      cwd: process.cwd(), encoding: "utf8",
      env: {
        ...process.env, CATALOG_TARGETED_DETAIL_BASE: baseDirectory, CATALOG_TARGETED_DETAIL_QUEUE: queueFile,
        CATALOG_TARGETED_DETAIL_CANDIDATES: candidatesFile, CATALOG_TARGETED_DETAIL_MARKET: "uae",
        CATALOG_TARGETED_DETAIL_DELTA_OUTPUT: deltaFile, CATALOG_TARGETED_DETAIL_DELTA_REPORT: reportFile,
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const rows = (await fsp.readFile(deltaFile, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].version, 1); assert.equal(rows[0].stage, "detail");
    assert.equal(rows[0].publicationReady, false); assert.equal(rows[0].offer.engineCc, 2494);
    assert.equal(rows[0].offer.sourcePrice, 145_000); assert.equal(rows[0].offer.firstSeenAt, capturedAt);
    assert.equal(rows[0].offer.operational.targetedDetailRecovery.fixedId, true);
    assert.equal(await fsp.readFile(baseFile, "utf8"), baseBytes, "the source artifact must remain byte-identical");
    const report = JSON.parse(await fsp.readFile(reportFile, "utf8"));
    assert.equal(report.productionWrites, false); assert.equal(report.networkRequests, 0);
    assert.equal(report.enriched, 1); assert.equal(report.invalid, 0);
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
});

test("identity drift produces no delta and a non-zero fail-closed result", async () => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), "targeted-detail-reject-"));
  try {
    const baseDirectory = path.join(temporary, "catalog-intake-uae");
    await fsp.mkdir(baseDirectory, { recursive: true });
    await fsp.writeFile(path.join(baseDirectory, "report.json"), JSON.stringify({ market: "uae", mode: "source_observations", productionWrites: false }));
    const observation = { version: 1, stage: "listing", publicationReady: false, offer: baseOffer() };
    await fsp.writeFile(path.join(baseDirectory, "base.jsonl"), JSON.stringify(observation) + "\n");
    const revisionHash = hash(observation);
    const queueFile = path.join(temporary, "queue.jsonl");
    const actionableNeeds = ["sourcePrice", "photos", "fuelPowertrain", "engineCc", "powerHp"];
    await fsp.writeFile(queueFile, JSON.stringify({ version: 1, market: "uae", sourceId: observation.offer.sourceId,
      offerId: observation.offer.id, sourceOfferId: observation.offer.sourceOfferId, inputRevisionHash: revisionHash,
      sourceUrl: observation.offer.operational.sourceUrl, latestStage: "listing", needs: actionableNeeds,
      actionableNeeds, transport: "direct_fixed_id", runnable: true }) + "\n");
    const bad = enrichedOffer(); bad.sourceOfferId = "999999";
    const candidatesFile = path.join(temporary, "candidates.jsonl");
    await fsp.writeFile(candidatesFile, JSON.stringify({ version: 1, market: "uae", sourceId: observation.offer.sourceId,
      offerId: observation.offer.id, sourceOfferId: observation.offer.sourceOfferId, inputRevisionHash: revisionHash,
      requestedNeeds: actionableNeeds, outcome: "candidate", offer: bad }) + "\n");
    const deltaFile = path.join(temporary, "delta.jsonl");
    const reportFile = path.join(temporary, "report-out.json");
    const result = spawnSync(process.execPath, [...runtimeArgs(), script], { cwd: process.cwd(), encoding: "utf8", env: {
      ...process.env, CATALOG_TARGETED_DETAIL_BASE: baseDirectory, CATALOG_TARGETED_DETAIL_QUEUE: queueFile,
      CATALOG_TARGETED_DETAIL_CANDIDATES: candidatesFile, CATALOG_TARGETED_DETAIL_MARKET: "uae",
      CATALOG_TARGETED_DETAIL_DELTA_OUTPUT: deltaFile, CATALOG_TARGETED_DETAIL_DELTA_REPORT: reportFile,
    }});
    assert.notEqual(result.status, 0);
    assert.equal(await fsp.readFile(deltaFile, "utf8"), "");
    const report = JSON.parse(await fsp.readFile(reportFile, "utf8"));
    assert.equal(report.enriched, 0); assert.equal(report.invalid, 1);
    assert.match(report.ledger[0].reason, /identity/);
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
});

test("a per-ID source failure stays unresolved while the offline delta step remains usable", async () => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), "targeted-detail-unresolved-"));
  try {
    const baseDirectory = path.join(temporary, "catalog-intake-uae");
    await fsp.mkdir(baseDirectory, { recursive: true });
    await fsp.writeFile(path.join(baseDirectory, "report.json"), JSON.stringify({ market: "uae", mode: "source_observations", productionWrites: false }));
    const observation = { version: 1, stage: "listing", publicationReady: false, offer: baseOffer() };
    await fsp.writeFile(path.join(baseDirectory, "base.jsonl"), JSON.stringify(observation) + "\n");
    const revisionHash = hash(observation);
    const actionableNeeds = ["sourcePrice", "photos", "fuelPowertrain", "engineCc", "powerHp"];
    const queueFile = path.join(temporary, "queue.jsonl");
    await fsp.writeFile(queueFile, JSON.stringify({ version: 1, market: "uae", sourceId: observation.offer.sourceId,
      offerId: observation.offer.id, sourceOfferId: observation.offer.sourceOfferId, inputRevisionHash: revisionHash,
      sourceUrl: observation.offer.operational.sourceUrl, latestStage: "listing", needs: actionableNeeds,
      actionableNeeds, transport: "direct_fixed_id", runnable: true }) + "\n");
    const candidatesFile = path.join(temporary, "candidates.jsonl");
    await fsp.writeFile(candidatesFile, JSON.stringify({ version: 1, market: "uae", sourceId: observation.offer.sourceId,
      offerId: observation.offer.id, sourceOfferId: observation.offer.sourceOfferId, inputRevisionHash: revisionHash,
      requestedNeeds: actionableNeeds, outcome: "unresolved", reason: "dubicars_refresh_http_429" }) + "\n");
    const deltaFile = path.join(temporary, "delta.jsonl");
    const reportFile = path.join(temporary, "report.json");
    const result = spawnSync(process.execPath, [...runtimeArgs(), script], { cwd: process.cwd(), encoding: "utf8", env: {
      ...process.env, CATALOG_TARGETED_DETAIL_BASE: baseDirectory, CATALOG_TARGETED_DETAIL_QUEUE: queueFile,
      CATALOG_TARGETED_DETAIL_CANDIDATES: candidatesFile, CATALOG_TARGETED_DETAIL_MARKET: "uae",
      CATALOG_TARGETED_DETAIL_DELTA_OUTPUT: deltaFile, CATALOG_TARGETED_DETAIL_DELTA_REPORT: reportFile,
    }});
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(await fsp.readFile(deltaFile, "utf8"), "");
    const report = JSON.parse(await fsp.readFile(reportFile, "utf8"));
    assert.equal(report.enriched, 0); assert.equal(report.unresolved, 1); assert.equal(report.invalid, 0);
    assert.equal(report.complete, false); assert.equal(report.targetMet, false);
    assert.equal(report.ledger[0].outcome, "unresolved");
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
});
