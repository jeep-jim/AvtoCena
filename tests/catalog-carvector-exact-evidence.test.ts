import assert from "node:assert/strict";
import test from "node:test";
import {
  CarvectorJapanExactAdapter,
  carvectorSpecificationEvidence,
  parseCarvectorNgState,
} from "../apps/web/lib/catalog/carvector-current-source";
import { classifySpecificationEvidence } from "../apps/web/lib/catalog/specification-evidence-audit";

const id = "00000000-0000-4000-8000-000000000001";
function row(overrides: Record<string, unknown> = {}) {
  return {
    __typename: "OfferAuction",
    id,
    kind: "AUCTION_STATS",
    urlPage: { fullUrl: `/stat/toyota/corolla/${id}` },
    make: { title: "Toyota" },
    model: { title: "Corolla" },
    chassis: { title: "3BA-ZRE212" },
    modification: { title: "G-X" },
    year: 2023,
    power: 140,
    engineVolume: 1797,
    mileage: 24_000,
    transmission: { title: "CVT" },
    color: { title: "Pearl" },
    fuel: { title: "Gasoline" },
    finishPrice: { JPY: 1_850_000 },
    startPrice: { JPY: 1_200_000 },
    auction: { title: "USS Tokyo" },
    auctionAt: "2026-08-25T03:30:00Z",
    lot: "71234",
    rate: { title: "4.5" },
    ...overrides,
  };
}

test("CarVector extracts only its nested auction-statistics result", () => {
  const wanted = {
    total: 2,
    offers: [row(), row({ id: "00000000-0000-4000-8000-000000000002" })],
  };
  const markup = `<script id="ng-state" type="application/json">${JSON.stringify(
    {
      irrelevant: { b: { data: { result: { total: 1, offers: [] } } } },
      hash: { b: { data: { result: wanted } } },
    },
  )}</script>`;
  assert.deepEqual(parseCarvectorNgState(markup), wanted);
  assert.throws(
    () => parseCarvectorNgState("<html></html>"),
    /ng_state_missing/,
  );
  assert.throws(
    () =>
      parseCarvectorNgState(
        `<script id="ng-state">${JSON.stringify({ INIT_STATE_PROJECT_CONTEXT: { rateLimited: true, retryAfterSeconds: 30 } })}</script>`,
      ),
    /rate_limited/,
  );
});

test("CarVector promotes a completed exact combustion auction result as evidence", () => {
  const offer = new CarvectorJapanExactAdapter().normalizeOffer(row());
  assert.ok(offer);
  assert.equal(offer.status, "sold");
  assert.equal(offer.catalogKind, "auction_result");
  assert.equal(offer.auctionPriceKind, "published_result");
  assert.equal(offer.sourcePrice, 1_850_000);
  assert.equal(offer.sourceCurrency, "JPY");
  assert.equal(offer.year, 2023);
  assert.equal(offer.engineCc, 1797);
  assert.equal(offer.powerHp, 140);
  assert.equal(offer.powerKw, 103);
  assert.equal(offer.fuel, "petrol");
  assert.equal(offer.powertrainKind, "combustion");
  assert.deepEqual(offer.images, []);
  assert.equal(offer.operational.raw?.carvectorEvidenceOnly, true);
  assert.equal(
    classifySpecificationEvidence(offer, "fuelPowertrain").state,
    "exact",
  );
  assert.equal(classifySpecificationEvidence(offer, "engineCc").state, "exact");
  assert.equal(classifySpecificationEvidence(offer, "powerHp").state, "exact");
});

test("CarVector rejects non-results, zero final prices and incomplete identity", () => {
  const source = new CarvectorJapanExactAdapter();
  assert.equal(source.normalizeOffer(row({ kind: "AUCTION" })), null);
  assert.equal(source.normalizeOffer(row({ finishPrice: { JPY: 0 } })), null);
  assert.equal(source.normalizeOffer(row({ chassis: { title: "" } })), null);
  assert.equal(
    source.normalizeOffer(
      row({ urlPage: { fullUrl: "/stat/toyota/corolla/different" } }),
    ),
    null,
  );
  assert.equal(
    source.normalizeOffer(row({ fuel: { title: "Unknown" } })),
    null,
  );
});

test("CarVector keeps electrified peak power out of customs power fields", () => {
  const hybrid = carvectorSpecificationEvidence(
    row({ fuel: { title: "Hybrid" }, power: 196 }),
  );
  assert.equal(hybrid.fuel.value, "hybrid");
  assert.equal(hybrid.powertrainKind.value, "other_hybrid");
  assert.equal(hybrid.powerHp.status, "missing");
  assert.equal(hybrid.powerKw.status, "missing");

  const electric = carvectorSpecificationEvidence(
    row({ fuel: { title: "Electric" }, engineVolume: 1800, power: 204 }),
  );
  assert.equal(electric.powertrainKind.value, "electric");
  assert.equal(electric.engineCc.status, "conflict");
  assert.equal(electric.powerHp.value, undefined);
});

test("CarVector cannot turn its auction-history thumbnails into a public gallery", async () => {
  const source = new CarvectorJapanExactAdapter();
  const offer = source.normalizeOffer(row());
  assert.ok(offer);
  assert.deepEqual(await source.fetchImages(offer), []);
});
