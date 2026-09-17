import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveSavedDetailNeeds,
  detailRecoveryCapability,
  validateEnrichedDetail,
} from "../apps/web/lib/catalog/saved-detail-recovery";

type Need = "sourcePrice" | "photos" | "fuelPowertrain" | "engineCc" | "powerHp" | "certifiedPower";

const capturedAt = "2026-09-17T00:00:00.000Z";

function image(id: string) {
  return {
    id,
    url: `https://cdn.example.test/${id}.jpg`,
    objectKey: "",
    size: 0,
    checksum: `source:${id}`,
    mimeType: "image/jpeg",
  };
}

function exact(value: unknown, source = "saved_exact_detail") {
  return { source, rawValues: [String(value)], status: "exact", value };
}

function missing(source = "saved_source_missing") {
  return { source, rawValues: [], status: "missing" };
}

function baseOffer(overrides: Record<string, unknown> = {}) {
  const offer: any = {
    id: "offer-1",
    sourceId: "dubicars_uae_exact",
    sourceOfferId: "1000265",
    market: "uae",
    offerType: "fixed",
    status: "active",
    make: "Toyota",
    model: "Camry",
    trim: "V6",
    year: 2024,
    engineCc: 3456,
    fuel: "petrol",
    powertrainKind: "combustion",
    powerHp: 301,
    powerDataConfidence: "source_exact",
    powerDataSource: "saved_exact_detail",
    sourcePrice: 145_000,
    sourceCurrency: "AED",
    priceMode: "fixed",
    images: [image("one"), image("two"), image("three"), image("four"), image("five")],
    calculationStatus: "needs_data",
    totalRub: null,
    firstSeenAt: capturedAt,
    updatedAt: capturedAt,
    operational: {
      sourceUrl: "https://www.dubicars.com/2024-toyota-camry-v6-1000265.html",
      detailIdentityVerified: true,
      fieldIdentityVerified: true,
      photoIdentityVerified: true,
      galleryVerified: true,
      galleryImageCount: 5,
      semanticEvidence: {
        year: exact(2024),
        fuel: exact("petrol"),
        engineCc: exact(3456),
        powerHp: exact(301),
      },
      raw: { cashPriceAuthority: "identity_bound_exact_detail" },
    },
  };
  const merged = { ...offer, ...overrides };
  if (overrides.operational) merged.operational = { ...offer.operational, ...(overrides.operational as object) };
  return merged;
}

function actionable(capability: ReturnType<typeof detailRecoveryCapability>): Need[] {
  return capability.actionable as Need[];
}

function skippedNeeds(capability: ReturnType<typeof detailRecoveryCapability>) {
  return new Map(capability.skipped.map((row: any) => [row.need, String(row.reason)]));
}

test("a complete identity-bound detail observation is not requested again", () => {
  const offer = baseOffer();
  assert.deepEqual(deriveSavedDetailNeeds(offer, "detail"), []);
  assert.deepEqual(actionable(detailRecoveryCapability(offer, [])), []);
});

test("CarSwitch queues its saved detail URL for exact price and photos, never for engine or power", () => {
  const offer = baseOffer({
    id: "carswitch-858598",
    sourceId: "carswitch_uae_open",
    sourceOfferId: "858598",
    engineCc: undefined,
    powerHp: undefined,
    powerDataConfidence: undefined,
    powerDataSource: undefined,
    sourcePrice: 208_000,
    images: [],
    operational: {
      sourceUrl: "https://carswitch.com/abudhabi/used-car/nissan/patrol/2024/858598",
      exactDetail: false,
      detailIdentityVerified: false,
      photoIdentityVerified: false,
      galleryVerified: false,
      galleryImageCount: 1,
      semanticEvidence: {
        year: exact(2024, "carswitch_listing_year"),
        fuel: missing("carswitch_listing_fuel_missing"),
        engineCc: missing("carswitch_listing_engine_missing"),
        powerHp: missing("carswitch_source_missing"),
      },
      raw: {
        detailIdentityVerified: false,
        cashPriceAuthority: "schema_org_offer_price",
        images: ["https://d1esl34bhh6pms.cloudfront.net/cars/used/images/original/a"],
      },
    },
  });
  const needs = deriveSavedDetailNeeds(offer, "listing") as Need[];
  assert.ok(needs.includes("sourcePrice"), "listing price must be confirmed by the exact detail page");
  assert.ok(needs.includes("photos"), "one unverified listing photo must request the exact detail gallery");
  assert.ok(needs.includes("engineCc"));
  assert.ok(needs.includes("powerHp"));

  const capability = detailRecoveryCapability(offer, needs, "listing");
  assert.ok(actionable(capability).includes("sourcePrice"));
  assert.ok(actionable(capability).includes("photos"));
  assert.ok(!actionable(capability).includes("engineCc"));
  assert.ok(!actionable(capability).includes("powerHp"));
  assert.match(skippedNeeds(capability).get("engineCc") || "", /carswitch|unsupported|unit/i);
  assert.match(skippedNeeds(capability).get("powerHp") || "", /carswitch|unsupported|power/i);
});

test("DubiCars queues missing detail price, gallery, and each exact-capable specification", () => {
  const offer = baseOffer({
    sourcePrice: null,
    sourceCurrency: null,
    engineCc: undefined,
    fuel: undefined,
    powertrainKind: "unknown",
    powerHp: undefined,
    powerDataConfidence: undefined,
    powerDataSource: undefined,
    images: [],
    operational: {
      detailIdentityVerified: false,
      fieldIdentityVerified: false,
      photoIdentityVerified: false,
      galleryVerified: false,
      galleryImageCount: 0,
      semanticEvidence: {
        year: exact(2024),
        fuel: missing(),
        engineCc: missing(),
        powerHp: missing(),
      },
      raw: {},
    },
  });
  const needs = deriveSavedDetailNeeds(offer, "listing") as Need[];
  assert.deepEqual(new Set(needs), new Set<Need>(["sourcePrice", "photos", "fuelPowertrain", "engineCc", "powerHp"]));
  const capability = detailRecoveryCapability(offer, needs, "listing");
  assert.deepEqual(new Set(actionable(capability)), new Set(needs));
  assert.deepEqual(capability.skipped, []);
});

test("known non-actionable power gaps do not create repeat detail traffic", () => {
  const kcar = baseOffer({
    id: "kcar-EC61398692",
    sourceId: "kcar_korea_open",
    sourceOfferId: "EC61398692",
    market: "korea",
    powerHp: undefined,
    powerDataConfidence: undefined,
    powerDataSource: undefined,
    operational: {
      sourceUrl: "https://www.kcar.com/bc/detail/carInfoDtl?i_sCarCd=EC61398692",
      semanticEvidence: { ...baseOffer().operational.semanticEvidence, powerHp: { source: "kcar_exact_detail_rvo_hrspow", rawValues: ["304"], status: "ambiguous" } },
    },
  });
  const kcarNeeds = deriveSavedDetailNeeds(kcar, "detail") as Need[];
  assert.ok(kcarNeeds.includes("powerHp"));
  const kcarCapability = detailRecoveryCapability(kcar, kcarNeeds, "detail");
  assert.ok(!actionable(kcarCapability).includes("powerHp"));
  assert.match(skippedNeeds(kcarCapability).get("powerHp") || "", /kcar|hrspow|unsupported/i);

  const autopapa = baseOffer({
    id: "autopapa-932906",
    sourceId: "autopapa_georgia_open",
    sourceOfferId: "932906",
    market: "georgia",
    powerHp: undefined,
    powerDataConfidence: undefined,
    powerDataSource: undefined,
    operational: {
      sourceUrl: "https://autopapa.ge/en/usd/chevrolet/captiva/932906",
      autoPapaDetailIdentityVerified: true,
      detailIdentityVerified: true,
      semanticEvidence: { ...baseOffer().operational.semanticEvidence, powerHp: missing("autopapa_exact_detail_power_missing") },
    },
  });
  const autopapaNeeds = deriveSavedDetailNeeds(autopapa, "detail") as Need[];
  assert.ok(autopapaNeeds.includes("powerHp"));
  const autopapaCapability = detailRecoveryCapability(autopapa, autopapaNeeds, "detail");
  assert.ok(!actionable(autopapaCapability).includes("powerHp"));
  assert.match(skippedNeeds(autopapaCapability).get("powerHp") || "", /already.*detail|autopapa|exhausted/i);
});

test("the capability filter admits only approved UAE, Georgia, and Korea source identities", () => {
  const japan = baseOffer({
    id: "drom-1",
    sourceId: "drom_japan_stat",
    sourceOfferId: "1",
    market: "japan",
    operational: { sourceUrl: "https://www.drom.ru/world/japan/1" },
  });
  const unknown = baseOffer({ sourceId: "unapproved_uae", operational: { sourceUrl: "https://example.test/1" } });
  for (const offer of [japan, unknown]) {
    const capability = detailRecoveryCapability(offer, ["sourcePrice", "photos"]);
    assert.deepEqual(actionable(capability), []);
    assert.equal(capability.skipped.length, 2);
  }
});

test("validated enrichment may change only requested exact evidence, price, photos, and audit metadata", () => {
  const base = baseOffer({
    sourcePrice: null,
    sourceCurrency: null,
    engineCc: undefined,
    images: [],
    operational: {
      photoIdentityVerified: false,
      galleryVerified: false,
      galleryImageCount: 0,
      semanticEvidence: { ...baseOffer().operational.semanticEvidence, engineCc: missing() },
      raw: {},
    },
  });
  const before = structuredClone(base);
  const candidate = structuredClone(base);
  candidate.engineCc = 2494;
  candidate.sourcePrice = 145_000;
  candidate.sourceCurrency = "AED";
  candidate.images = [image("one"), image("two"), image("three"), image("four"), image("five")];
  candidate.updatedAt = "2026-09-17T01:00:00.000Z";
  candidate.operational.semanticEvidence.engineCc = exact(2494, "dubicars_detail_engine_capacity");
  candidate.operational.detailIdentityVerified = true;
  candidate.operational.fieldIdentityVerified = true;
  candidate.operational.photoIdentityVerified = true;
  candidate.operational.galleryVerified = true;
  candidate.operational.galleryImageCount = 5;
  candidate.operational.raw = { cashPriceAuthority: "identity_bound_exact_detail" };
  candidate.operational.sourceExactFields = ["engineCc", "transmission"];
  candidate.operational.sourceSpecifications = { version: 1, sourceId: base.sourceId, sourceOfferId: base.sourceOfferId,
    specificationId: base.sourceOfferId, sourceUrl: base.operational.sourceUrl, capturedAt,
    groups: [{ name: "new table", items: [{ name: "Transmission", value: "Automatic" }] }] };
  const accepted = validateEnrichedDetail(base, candidate, ["engineCc", "sourcePrice", "photos"]);
  assert.equal(accepted.operational.sourceExactFields, undefined);
  assert.equal(accepted.operational.sourceSpecifications, undefined);
  assert.deepEqual(base, before, "validation must never mutate the saved base observation");

  const nonExact = structuredClone(candidate);
  nonExact.operational.semanticEvidence.engineCc = { source: "rounded_title", rawValues: ["2.5 L"], status: "ambiguous" };
  assert.throws(() => validateEnrichedDetail(base, nonExact, ["engineCc", "sourcePrice", "photos"]));

  const unrequested = structuredClone(candidate);
  unrequested.powerHp = 181;
  unrequested.operational.semanticEvidence.powerHp = exact(181);
  assert.throws(() => validateEnrichedDetail(base, unrequested, ["engineCc", "sourcePrice", "photos"]));

  const unrelated = structuredClone(candidate);
  unrelated.transmission = "automatic";
  assert.throws(() => validateEnrichedDetail(base, unrelated, ["engineCc", "sourcePrice", "photos"]));

  const untargetedEvidenceRegression = structuredClone(candidate);
  untargetedEvidenceRegression.operational.semanticEvidence.powerHp = {
    source: "unverified_detail_text",
    rawValues: ["301"],
    status: "ambiguous",
  };
  assert.throws(() => validateEnrichedDetail(base, untargetedEvidenceRegression, ["engineCc", "sourcePrice", "photos"]));
});

test("KCar photo recovery keeps the five-image source gate", () => {
  const base = baseOffer({
    id: "kcar-EC61398692", sourceId: "kcar_korea_open", sourceOfferId: "EC61398692", market: "korea",
    images: [], operational: {
      sourceUrl: "https://www.kcar.com/bc/detail/carInfoDtl?i_sCarCd=EC61398692",
      detailIdentityVerified: true, photoIdentityVerified: false, galleryVerified: false,
      semanticEvidence: baseOffer().operational.semanticEvidence, raw: { detailIdentityVerified: true },
    },
  });
  const candidate = structuredClone(base);
  candidate.images = [image("one"), image("two")];
  candidate.operational.photoIdentityVerified = true;
  candidate.operational.galleryVerified = true;
  candidate.operational.raw.photoIdentityVerified = true;
  assert.throws(() => validateEnrichedDetail(base, candidate, ["photos"]), /photos_unverified/);
});

test("enriched deltas fail closed on every immutable identity boundary", () => {
  const base = baseOffer();
  const mutations: Array<(offer: any) => void> = [
    (offer) => { offer.id = "other-id"; },
    (offer) => { offer.sourceOfferId = "other-source-offer"; },
    (offer) => { offer.sourceId = "carswitch_uae_open"; },
    (offer) => { offer.market = "georgia"; },
    (offer) => { offer.operational.sourceUrl = "https://www.dubicars.com/other-999999.html"; },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(base);
    mutate(candidate);
    assert.throws(() => validateEnrichedDetail(base, candidate, ["photos"]));
  }
});
