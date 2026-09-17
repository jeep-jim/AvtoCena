import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const script = "scripts/catalog-build-targeted-detail-queue.mjs";
const fetchScript = "scripts/catalog-fetch-targeted-detail-candidates.mjs";
const now = "2026-09-17T00:00:00.000Z";

function exact(value: unknown) {
  return { source: "fixture_exact", rawValues: [String(value)], status: "exact", value };
}

function missing() {
  return { source: "fixture_missing", rawValues: [], status: "missing" };
}

function observation({
  id,
  sourceId,
  sourceOfferId = id,
  market,
  sourceUrl,
  stage = "listing",
  exactDetail = false,
  complete = false,
}: {
  id: string;
  sourceId: string;
  sourceOfferId?: string;
  market: string;
  sourceUrl: string;
  stage?: "listing" | "detail";
  exactDetail?: boolean;
  complete?: boolean;
}) {
  const photos = complete
    ? Array.from({ length: 5 }, (_, index) => ({
        id: `${id}-${index}`,
        url: `https://cdn.example.test/${id}/${index}.jpg`,
        objectKey: "",
        size: 0,
        checksum: `source:${id}-${index}`,
        mimeType: "image/jpeg",
      }))
    : [];
  return {
    version: 1,
    stage,
    publicationReady: false,
    offer: {
      id,
      sourceId,
      sourceOfferId,
      market,
      offerType: "fixed",
      status: "active",
      make: "Toyota",
      model: "Camry",
      year: 2024,
      ...(complete ? { engineCc: 2494, fuel: "petrol", powertrainKind: "combustion", powerHp: 181 } : {}),
      sourcePrice: complete ? 145_000 : null,
      sourceCurrency: complete ? (market === "korea" ? "KRW" : market === "georgia" ? "USD" : "AED") : null,
      priceMode: "fixed",
      images: photos,
      totalRub: null,
      calculationStatus: "needs_data",
      firstSeenAt: now,
      updatedAt: now,
      operational: {
        sourceUrl,
        detailIdentityVerified: exactDetail,
        fieldIdentityVerified: exactDetail,
        photoIdentityVerified: complete,
        galleryVerified: complete,
        galleryImageCount: photos.length,
        semanticEvidence: {
          year: exact(2024),
          fuel: complete ? exact("petrol") : missing(),
          engineCc: complete ? exact(2494) : missing(),
          powerHp: complete ? exact(181) : missing(),
        },
        raw: exactDetail ? { cashPriceAuthority: "identity_bound_exact_detail" } : {},
      },
    },
  };
}

async function writeArtifact(root: string, market: string, rows: unknown[]) {
  const directory = path.join(root, `catalog-intake-${market}`);
  await fsp.mkdir(directory, { recursive: true });
  await fsp.writeFile(path.join(directory, "saved-000001.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  await fsp.writeFile(path.join(directory, "report.json"), JSON.stringify({
    market,
    mode: "source_observations",
    productionWrites: false,
  }) + "\n");
}

function itemId(item: any) {
  return String(item?.offerId || item?.id || item?.offer?.id || "");
}

function inheritedRuntimeArgs() {
  return process.execArgv.filter((arg) => arg !== "--test" && !arg.startsWith("--test-"));
}

async function readJsonl(file: string) {
  const text = await fsp.readFile(file, "utf8");
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

test("the queue builder is an offline artifact reader, not another collector or publisher", () => {
  const source = fs.readFileSync(script, "utf8");
  assert.doesNotMatch(source, /catalogImportSources|catalog-source-intake|\.fetchPage\s*\(|\.fetchImages\s*\(|\.refreshOffer\s*\(/);
  assert.doesNotMatch(source, /publish-autocatalog|catalog-publish-market|writeDataJson|replaceChunkedDataJson|S3_BUCKET|DATABASE_URL|POSTGRES_URL/);
});

test("the candidate fetcher has no list/publish fallback and keeps bridge-only IDs unresolved", async () => {
  const source = fs.readFileSync(fetchScript, "utf8");
  assert.doesNotMatch(source, /\.fetchPage\s*\(|catalogImportSources|catalog-source-intake|publish-autocatalog|persistCatalog|ObjectJsonStorage/);

  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), "targeted-detail-bridge-"));
  try {
    const input = path.join(temporary, "input");
    const autopapa = observation({ id: "autopapa-listing", sourceId: "autopapa_georgia_open", sourceOfferId: "932906",
      market: "georgia", sourceUrl: "https://autopapa.ge/en/usd/chevrolet/captiva/932906" });
    await writeArtifact(input, "georgia", [autopapa]);
    const base = path.join(input, "catalog-intake-georgia");
    const queue = path.join(temporary, "queue.jsonl");
    const queueReport = path.join(temporary, "queue-report.json");
    const built = spawnSync(process.execPath, [...inheritedRuntimeArgs(), script], { cwd: process.cwd(), encoding: "utf8", env: {
      ...process.env, CATALOG_TARGETED_DETAIL_INPUT: base, CATALOG_TARGETED_DETAIL_MARKET: "georgia",
      CATALOG_TARGETED_DETAIL_OUTPUT: queue, CATALOG_TARGETED_DETAIL_REPORT: queueReport,
    }});
    assert.equal(built.status, 0, built.stderr || built.stdout);
    const queued = await readJsonl(queue);
    assert.equal(queued.length, 1); assert.equal(queued[0].transport, "fixed_id_bridge_required");
    assert.equal(queued[0].runnable, false);

    const candidates = path.join(temporary, "candidates.jsonl");
    const candidateReport = path.join(temporary, "candidate-report.json");
    const fetched = spawnSync(process.execPath, [...inheritedRuntimeArgs(), fetchScript], { cwd: process.cwd(), encoding: "utf8", env: {
      ...process.env, CATALOG_TARGETED_DETAIL_BASE: base, CATALOG_TARGETED_DETAIL_QUEUE: queue,
      CATALOG_TARGETED_DETAIL_MARKET: "georgia", CATALOG_TARGETED_DETAIL_CANDIDATES_OUTPUT: candidates,
      CATALOG_TARGETED_DETAIL_CANDIDATES_REPORT: candidateReport,
    }});
    assert.equal(fetched.status, 0, fetched.stderr || fetched.stdout);
    const candidateRows = await readJsonl(candidates);
    assert.equal(candidateRows.length, 1); assert.equal(candidateRows[0].outcome, "unresolved");
    assert.equal(candidateRows[0].reason, "fixed_id_bridge_required");
    const report = JSON.parse(await fsp.readFile(candidateReport, "utf8"));
    assert.equal(report.productionWrites, false); assert.equal(report.listRequests, 0); assert.equal(report.attempted, 0);
    assert.equal(report.unresolved, 1); assert.equal(report.contractFailures, 0); assert.equal(report.complete, false);
    assert.equal(report.hasEnrichedCandidates, false);
  } finally { await fsp.rm(temporary, { recursive: true, force: true }); }
});

test("the candidate fetcher enforces its fixed-ID request budget before any network call", async () => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), "targeted-detail-budget-"));
  try {
    const input = path.join(temporary, "input");
    const rows = ["858598", "858599"].map((id) => observation({ id: `carswitch-${id}`, sourceId: "carswitch_uae_open",
      sourceOfferId: id, market: "uae", sourceUrl: `https://carswitch.com/abudhabi/used-car/nissan/patrol/2024/${id}` }));
    await writeArtifact(input, "uae", rows);
    const base = path.join(input, "catalog-intake-uae");
    const queue = path.join(temporary, "queue.jsonl");
    const built = spawnSync(process.execPath, [...inheritedRuntimeArgs(), script], { cwd: process.cwd(), encoding: "utf8", env: {
      ...process.env, CATALOG_TARGETED_DETAIL_INPUT: base, CATALOG_TARGETED_DETAIL_MARKET: "uae",
      CATALOG_TARGETED_DETAIL_OUTPUT: queue, CATALOG_TARGETED_DETAIL_REPORT: path.join(temporary, "queue-report.json"),
    }});
    assert.equal(built.status, 0, built.stderr || built.stdout);
    assert.equal((await readJsonl(queue)).length, 2);
    const fetched = spawnSync(process.execPath, [...inheritedRuntimeArgs(), fetchScript], { cwd: process.cwd(), encoding: "utf8", env: {
      ...process.env, CATALOG_TARGETED_DETAIL_BASE: base, CATALOG_TARGETED_DETAIL_QUEUE: queue,
      CATALOG_TARGETED_DETAIL_MARKET: "uae", CATALOG_TARGETED_DETAIL_MAX_REQUESTS: "1",
      CATALOG_TARGETED_DETAIL_CANDIDATES_OUTPUT: path.join(temporary, "candidates.jsonl"),
      CATALOG_TARGETED_DETAIL_CANDIDATES_REPORT: path.join(temporary, "candidate-report.json"),
    }});
    assert.notEqual(fetched.status, 0);
    assert.match(fetched.stderr, /targeted_detail_request_limit:2:1/);
  } finally { await fsp.rm(temporary, { recursive: true, force: true }); }
});

test("the offline queue is deduplicated by saved offer id and contains only actionable UAE, Georgia, or Korea details", async () => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), "targeted-detail-queue-"));
  try {
    const input = path.join(temporary, "input");
    const queuePath = path.join(temporary, "queue.json");
    const reportPath = path.join(temporary, "report.json");

    const carswitchListing = observation({
      id: "carswitch-listing-only",
      sourceId: "carswitch_uae_open",
      sourceOfferId: "858598",
      market: "uae",
      sourceUrl: "https://carswitch.com/abudhabi/used-car/nissan/patrol/2024/858598",
    });
    const carswitchRecoveredListing = observation({
      id: "carswitch-already-recovered",
      sourceId: "carswitch_uae_open",
      sourceOfferId: "858599",
      market: "uae",
      sourceUrl: "https://carswitch.com/abudhabi/used-car/nissan/patrol/2024/858599",
    });
    const carswitchRecoveredDetail = observation({
      id: "carswitch-already-recovered",
      sourceId: "carswitch_uae_open",
      sourceOfferId: "858599",
      market: "uae",
      sourceUrl: "https://carswitch.com/abudhabi/used-car/nissan/patrol/2024/858599",
      stage: "detail",
      exactDetail: true,
      complete: true,
    });
    const dubicars = observation({
      id: "dubicars-needs-detail",
      sourceId: "dubicars_uae_exact",
      sourceOfferId: "1000265",
      market: "uae",
      sourceUrl: "https://www.dubicars.com/2024-toyota-camry-v6-1000265.html",
    });
    await writeArtifact(input, "uae", [carswitchListing, carswitchRecoveredListing, carswitchRecoveredDetail, dubicars]);

    const autopapaExhausted = observation({
      id: "autopapa-detail-without-power",
      sourceId: "autopapa_georgia_open",
      sourceOfferId: "932906",
      market: "georgia",
      sourceUrl: "https://autopapa.ge/en/usd/chevrolet/captiva/932906",
      stage: "detail",
      exactDetail: true,
      complete: true,
    });
    delete (autopapaExhausted.offer as any).powerHp;
    (autopapaExhausted.offer as any).operational.semanticEvidence.powerHp = missing();
    await writeArtifact(input, "georgia", [autopapaExhausted]);

    const kcarUnsupportedPower = observation({
      id: "kcar-ambiguous-power",
      sourceId: "kcar_korea_open",
      sourceOfferId: "EC61398692",
      market: "korea",
      sourceUrl: "https://www.kcar.com/bc/detail/carInfoDtl?i_sCarCd=EC61398692",
      stage: "detail",
      exactDetail: true,
      complete: true,
    });
    delete (kcarUnsupportedPower.offer as any).powerHp;
    (kcarUnsupportedPower.offer as any).operational.semanticEvidence.powerHp = {
      source: "kcar_exact_detail_rvo_hrspow",
      rawValues: ["304"],
      status: "ambiguous",
    };
    await writeArtifact(input, "korea", [kcarUnsupportedPower]);

    await writeArtifact(input, "japan", [observation({
      id: "japan-must-never-enter-targeted-recovery",
      sourceId: "drom_japan_stat",
      sourceOfferId: "123",
      market: "japan",
      sourceUrl: "https://www.drom.ru/world/japan/123",
    })]);
    await writeArtifact(input, "europe", [observation({
      id: "europe-must-not-enter-targeted-recovery",
      sourceId: "mobile_de_open",
      sourceOfferId: "456",
      market: "europe",
      sourceUrl: "https://suchen.mobile.de/fahrzeuge/details.html?id=456",
    })]);

    const uaeInput = path.join(input, "catalog-intake-uae");
    const env = {
      ...process.env,
      CATALOG_TARGETED_DETAIL_INPUT: uaeInput,
      CATALOG_TARGETED_DETAIL_MARKET: "uae",
      CATALOG_TARGETED_DETAIL_OUTPUT: queuePath,
      CATALOG_TARGETED_DETAIL_REPORT: reportPath,
    };
    const result = spawnSync(process.execPath, [...inheritedRuntimeArgs(), script], {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const queue = await readJsonl(queuePath);
    assert.deepEqual(new Set(queue.map(itemId)), new Set(["carswitch-listing-only", "dubicars-needs-detail"]));
    assert.ok(queue.every((item: any) => ["uae", "georgia", "korea"].includes(item.market || item.offer?.market)));
    assert.ok(queue.every((item: any) => (item.actionableNeeds || item.needs || []).length > 0));

    const byId = new Map(queue.map((item: any) => [itemId(item), item]));
    const carswitchNeeds = new Set((byId.get("carswitch-listing-only") as any)?.actionableNeeds || (byId.get("carswitch-listing-only") as any)?.needs || []);
    assert.ok(carswitchNeeds.has("sourcePrice"));
    assert.ok(carswitchNeeds.has("photos"));
    assert.ok(carswitchNeeds.has("fuelPowertrain"));
    assert.ok(!carswitchNeeds.has("engineCc"));
    assert.ok(!carswitchNeeds.has("powerHp"));
    const carswitchSkipped = new Set(((byId.get("carswitch-listing-only") as any)?.skipped || []).map((row: any) => row.need));
    assert.ok(carswitchSkipped.has("engineCc"));
    assert.ok(carswitchSkipped.has("powerHp"));
    const dubicarsNeeds = new Set((byId.get("dubicars-needs-detail") as any)?.actionableNeeds || (byId.get("dubicars-needs-detail") as any)?.needs || []);
    assert.deepEqual(dubicarsNeeds, new Set(["sourcePrice", "photos", "fuelPowertrain", "engineCc", "powerHp"]));

    const report = JSON.parse(await fsp.readFile(reportPath, "utf8"));
    assert.equal(report.productionWrites, false);
    assert.equal(report.networkRequests, 0);
    assert.equal(report.queued ?? report.queuedOffers, 2);

    const rejectedJapan = spawnSync(process.execPath, [...inheritedRuntimeArgs(), script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CATALOG_TARGETED_DETAIL_INPUT: path.join(input, "catalog-intake-japan"),
        CATALOG_TARGETED_DETAIL_MARKET: "japan",
        CATALOG_TARGETED_DETAIL_OUTPUT: path.join(temporary, "japan-queue.jsonl"),
        CATALOG_TARGETED_DETAIL_REPORT: path.join(temporary, "japan-report.json"),
      },
      encoding: "utf8",
    });
    assert.notEqual(rejectedJapan.status, 0, "Japan must be rejected before reading or queueing its saved artifact");
    assert.match(rejectedJapan.stderr, /targeted_detail_market_invalid:japan/);
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
});
