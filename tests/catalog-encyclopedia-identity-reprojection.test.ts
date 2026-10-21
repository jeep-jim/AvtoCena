import assert from "node:assert/strict";
import test from "node:test";
import { EncyclopediaIdentityResolver } from "../apps/web/lib/catalog/encyclopedia-identity";
import { planEncyclopediaIdentityReprojection } from "../apps/web/lib/catalog/encyclopedia-identity-reprojection";

const resolver = new EncyclopediaIdentityResolver({
  brands: [
    { id: "aito", canonicalName: "AITO", aliases: [{ value: "AITO Wenjie", safe: true }] },
    { id: "baw", canonicalName: "BAW", aliases: [{ value: "BAW (Beijing Automobile Works)", safe: true }] },
  ],
  models: [
    { id: "aito/m9", brandId: "aito", canonicalName: "M9", aliases: [{ value: "AITO M9", safe: true }] },
    { id: "baw/m7", brandId: "baw", canonicalName: "M7" },
  ],
});

function offer(overrides: Record<string, unknown> = {}) {
  return {
    id: "offer-1",
    sourceId: "source-a",
    market: "china",
    make: "AITO Wenjie",
    model: "AITO M9",
    year: 2025,
    mileageKm: 12000,
    totalRub: 3900000,
    images: [{ id: "img-1", url: "/x" }],
    operational: {
      sourceUrl: "https://example.test/1",
      vin: "TESTVIN1234567890",
      frameNumber: "FRAME-1",
      raw: { make: "AITO Wenjie", nested: { sourceId: 7 } },
    },
    ...overrides,
  };
}

test("reprojection collapses safe duplicate identity without changing commercial or source fields", () => {
  const input = offer();
  const { rows, report } = planEncyclopediaIdentityReprojection(resolver, [input]);
  assert.equal(rows[0].make, "AITO");
  assert.equal(rows[0].model, "M9");
  assert.equal(rows[0].id, input.id);
  assert.equal(rows[0].market, input.market);
  assert.equal(rows[0].totalRub, input.totalRub);
  assert.equal(rows[0].mileageKm, input.mileageKm);
  assert.deepEqual(rows[0].images, input.images);
  assert.equal(rows[0].operational.sourceUrl, input.operational.sourceUrl);
  assert.equal(rows[0].operational.vin, input.operational.vin);
  assert.equal(rows[0].operational.frameNumber, input.operational.frameNumber);
  assert.deepEqual(rows[0].operational.raw, input.operational.raw);
  assert.equal(rows[0].operational.encyclopediaIdentity.canonicalBrandId, "aito");
  assert.equal(rows[0].operational.encyclopediaIdentity.canonicalModelId, "aito/m9");
  assert.equal(report.total, 1);
  assert.equal(report.changed, 1);
  assert.equal(report.brandChanged, 1);
  assert.equal(report.modelChanged, 1);
  assert.equal(report.fullyResolved, 1);
});

test("reprojection reports brand collapse across multiple source spellings", () => {
  const rows = [
    offer({ id: "1", make: "AITO", model: "M9" }),
    offer({ id: "2", make: "AITO Wenjie", model: "AITO M9" }),
    offer({ id: "3", make: "BAW", model: "M7" }),
    offer({ id: "4", make: "BAW (Beijing Automobile Works)", model: "M7" }),
  ];
  const result = planEncyclopediaIdentityReprojection(resolver, rows);
  assert.equal(result.report.beforeBrands, 4);
  assert.equal(result.report.afterBrands, 2);
  assert.equal(result.report.beforeMakeModels, 4);
  assert.equal(result.report.afterMakeModels, 2);
});

test("unresolved identities are retained rather than deleted", () => {
  const input = offer({ id: "unknown", make: "Brand Never Seen", model: "X" });
  const result = planEncyclopediaIdentityReprojection(resolver, [input]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].make, "Brand Never Seen");
  assert.equal(result.rows[0].model, "X");
  assert.equal(result.report.unresolvedBrands, 1);
  assert.equal(result.report.changed, 0);
});

test("duplicate offer IDs fail the dry-run before any publication is possible", () => {
  assert.throws(
    () => planEncyclopediaIdentityReprojection(resolver, [offer({ id: "dup" }), offer({ id: "dup" })]),
    /encyclopedia_reprojection_offer_id_duplicate:dup/,
  );
});
