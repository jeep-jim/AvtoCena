import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const workflow = fs.readFileSync(
  new URL(
    "../.github/workflows/catalog-v6-four-market-exact-dry-run.yml",
    import.meta.url,
  ),
  "utf8",
);
const collector = fs.readFileSync(
  new URL("../scripts/catalog-live-recovery-market.mjs", import.meta.url),
  "utf8",
);
const audit = fs.readFileSync(
  new URL(
    "../scripts/catalog-four-market-exact-dry-run-audit.mjs",
    import.meta.url,
  ),
  "utf8",
);

test("four-market dry-run excludes China/Japan and cannot write production storage", () => {
  for (const market of ["korea", "uae", "europe", "georgia"])
    assert.match(workflow, new RegExp(`market: ${market}`));
  assert.doesNotMatch(workflow, /market: (?:china|japan)/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /RECOVERY_STRICT_PUBLIC_READY: "1"/);
  assert.match(workflow, /CATALOG_KNOWLEDGE_DISABLED: "1"/);
  assert.doesNotMatch(
    workflow,
    /JSON_STORAGE|S3_|AWS_|YC_|storage-secret|catalog-publish|catalog-clean/,
  );
});

test("strict recovery rejects preliminary calculations and non-exact specifications", () => {
  assert.match(collector, /strictPublicReady/);
  assert.match(collector, /strict_preliminary_calculation/);
  assert.match(collector, /classifySpecificationEvidence/);
  assert.match(collector, /catalogPublicPriority/);
  assert.match(collector, /return BODY_VALUES\.has\(body\)/);
  assert.match(collector, /writes: false/);
});

test("post-collection audit checks every public-critical field and remains local", () => {
  assert.match(audit, /SPECIFICATION_AUDIT_FIELDS/);
  assert.match(audit, /body_noncanonical/);
  assert.match(audit, /gallery_below_minimum/);
  assert.match(audit, /preliminary_calculation/);
  assert.match(audit, /catalogPublicPriority/);
  assert.match(audit, /writes: false/);
  assert.doesNotMatch(
    audit,
    /getJsonStorage|writeDataJson|replaceChunkedDataJson|persistCatalogOffers/,
  );
});

function exactCombustionOffer() {
  const priceLines = [
    "car",
    "topavto-commission",
    "broker",
    "svh",
    "laboratory",
    "sbkts",
    "epts",
    "rf-delivery",
    "customs",
  ].map((id) => ({ id, amountRub: 100_000 }));
  return {
    id: "encar-1",
    sourceId: "encar_direct",
    sourceOfferId: "1",
    market: "korea",
    status: "active",
    make: "Hyundai",
    model: "Avante",
    year: 2023,
    bodyType: "sedan",
    fuel: "petrol",
    powertrainKind: "combustion",
    engineCc: 1598,
    powerHp: 123,
    powerKw: 90.5,
    powerDataConfidence: "source_exact",
    powerDataSource: "encar exact detail",
    sourcePrice: 20_000_000,
    sourceCurrency: "KRW",
    totalRub: 2_500_000,
    calculationStatus: "ready",
    calculationSnapshot: {
      pricingConfidence: "exact",
      currencyRate: { sourcePriceRub: 1_500_000 },
      customs: { status: "ready", totalCustomsRub: 500_000 },
      breakdown: priceLines,
    },
    images: Array.from({ length: 5 }, (_, index) => ({
      id: `image-${index}`,
      url: `https://img.encar.com/car-${index}.jpg`,
    })),
    operational: {
      sourceUrl:
        "https://www.encar.com/dc/dc_cardetailview.do?pageid=dc_carsearch&carid=1",
      semanticEvidence: {
        year: { status: "exact" },
        fuel: { status: "exact" },
        engineCc: { status: "exact" },
        powerHp: { status: "exact" },
      },
      raw: {
        recoveryExactSourceUrl: true,
        recoveryExactPhotoIdentity: true,
        recoveryBodySourceOnly: true,
        recoveryStrictPublicReady: true,
      },
    },
  };
}

function runAudit(offer: ReturnType<typeof exactCombustionOffer>) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "avtocena-four-market-audit-"),
  );
  const input = path.join(directory, "input.json");
  const output = path.join(directory, "audit.json");
  fs.writeFileSync(
    input,
    JSON.stringify({
      market: "korea",
      offers: [offer],
      report: {
        writes: false,
        strictPublicReady: true,
        sources: [{ sourceId: "encar_direct" }],
      },
    }),
  );
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      new URL(
        "../scripts/catalog-four-market-exact-dry-run-audit.mjs",
        import.meta.url,
      ).pathname,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        RECOVERY_MARKET: "korea",
        RECOVERY_SOURCE_IDS: "encar_direct",
        RECOVERY_OUTPUT: input,
        RECOVERY_AUDIT_OUTPUT: output,
        CATALOG_REBUILD_MIN_IMAGES_PER_OFFER: "5",
      },
    },
  );
  const report = JSON.parse(fs.readFileSync(output, "utf8"));
  fs.rmSync(directory, { recursive: true, force: true });
  return { result, report };
}

test("post-collection audit passes a fully attested exact card", () => {
  const { result, report } = runAudit(exactCombustionOffer());
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(report.passed, true);
  assert.equal(report.count, 1);
});

test("post-collection audit rejects a wrong body or missing exact customs total", () => {
  const offer = exactCombustionOffer();
  offer.bodyType = "mystery";
  delete (offer.calculationSnapshot.customs as { totalCustomsRub?: number })
    .totalCustomsRub;
  const { result, report } = runAudit(offer);
  assert.equal(result.status, 1);
  assert.equal(report.passed, false);
  assert.ok(report.invalid[0].problems.includes("body_noncanonical"));
  assert.ok(
    report.invalid[0].problems.includes("exact_customs_calculation_missing"),
  );
});
