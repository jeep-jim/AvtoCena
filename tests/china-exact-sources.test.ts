import assert from "node:assert/strict";
import test from "node:test";
import { guaziChinaExactSource, guaziSpecificationEvidence, isGuaziSourceBotChallenge, listingEngineCc } from "../apps/web/lib/catalog/china-exact-sources";
import { classifySpecificationEvidence } from "../apps/web/lib/catalog/specification-evidence-audit";

test("Guazi listing identity recovers compact and decimal engine displacement", () => {
  assert.equal(listingEngineCc("https://en.guazi.com/products/skoda-superb-2024-14l-gray-5699km-at-2wd-5-seats-mg5wftcmmz.html"), 1_400);
  assert.equal(listingEngineCc("Used BMW X1 2023 1.5L"), 1_500);
  assert.equal(listingEngineCc("https://en.guazi.com/products/buick-e4-2023-00l-white-40100km-at-2wd-5-seats-j3shshfxpy.html"), undefined);
});

test("Guazi exact normalized offer keeps listing-bound engine displacement", () => {
  const offer = guaziChinaExactSource.normalizeOffer({
    id: "skoda-superb-2024-14l-gray-5699km-at-2wd-5-seats-mg5wftcmmz",
    detailUrl: "https://en.guazi.com/products/skoda-superb-2024-14l-gray-5699km-at-2wd-5-seats-mg5wftcmmz.html",
    title: "Used Skoda Superb 2024",
    year: 2024,
    mileageKm: 5_699,
    price: 12_345,
    currency: "USD",
    listingText: "Used Skoda Superb 2024 5,699 km",
  });
  assert.ok(offer);
  assert.equal(offer?.sourceId, "guazi_china_open");
  assert.equal(offer?.engineCc, 1_400);
  assert.equal(offer?.operational?.sourceUrl, "https://en.guazi.com/products/skoda-superb-2024-14l-gray-5699km-at-2wd-5-seats-mg5wftcmmz.html");
  assert.equal(offer?.fuel, undefined);
  assert.equal(offer?.powertrainKind, "unknown");
  assert.equal(offer?.powerHp, undefined);
  assert.equal(classifySpecificationEvidence(offer!, "year").state, "exact");
  assert.equal(classifySpecificationEvidence(offer!, "engineCc").state, "exact");
  assert.equal(classifySpecificationEvidence(offer!, "fuelPowertrain").state, "missing");
  assert.equal(classifySpecificationEvidence(offer!, "powerHp").state, "missing");
});

test("Guazi conflicting title and product URL displacement fails closed", () => {
  const evidence = guaziSpecificationEvidence({
    listingYear: 2024,
    title: "Used Skoda Superb 2024 2.0L",
    detailUrl: "https://en.guazi.com/products/skoda-superb-2024-14l-gray-5699km-at-2wd-5-seats-mg5wftcmmz.html",
  });
  assert.equal(evidence.year.status, "exact");
  assert.equal(evidence.engineCc.status, "conflict");
  assert.equal(evidence.engineCc.value, undefined);
});

test("Guazi never promotes ranges, zero-L placeholders, fuel or horsepower from free text", () => {
  const range = guaziSpecificationEvidence({ listingYear: 2024, title: "Used Test Car 2024 1.5-2.0L 300 HP" });
  assert.equal(range.engineCc.status, "ambiguous");
  assert.equal(range.engineCc.value, undefined);
  assert.equal(range.powerHp.status, "missing");
  assert.equal(range.fuel.status, "missing");

  const electricPlaceholder = guaziSpecificationEvidence({
    listingYear: 2023,
    title: "Used Buick E4 2023",
    detailUrl: "https://en.guazi.com/products/buick-e4-2023-00l-white-40100km-at-2wd-5-seats-j3shshfxpy.html",
  });
  assert.equal(electricPlaceholder.engineCc.status, "ambiguous");
  assert.equal(electricPlaceholder.engineCc.value, undefined);
});

test("Guazi rejects conflicting listing, title and URL years", () => {
  const evidence = guaziSpecificationEvidence({
    listingYear: 2024,
    title: "Used Toyota Camry 2023",
    detailUrl: "https://en.guazi.com/products/toyota-camry-2024-20l-white-stock.html",
  });
  assert.equal(evidence.year.status, "conflict");
  assert.equal(evidence.year.value, undefined);
});


test("Guazi identifies the successful-HTTP Tencent EdgeOne challenge as blocked", async () => {
  const challenge = `<!doctype html><script>window["EO-Bot-Js-Token"]="token";solveChallenge();</script><div>TencentEdgeOne</div>`;
  assert.equal(isGuaziSourceBotChallenge(challenge), true);
  assert.equal(isGuaziSourceBotChallenge("<a href='/products/toyota-corolla-2024.html'>Used Toyota Corolla 2024</a>"), false);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(challenge, { status: 200, headers: { "content-type": "text/html" } });
  try {
    await assert.rejects(
      () => guaziChinaExactSource.fetchPage("1"),
      (error: unknown) => {
        const sourceError = error as Error & { blocked?: boolean; status?: number };
        assert.equal(sourceError.message, "guazi_source_blocked_bot_challenge");
        assert.equal(sourceError.blocked, true);
        assert.equal(sourceError.status, 200);
        return true;
      },
    );
    const health = await guaziChinaExactSource.healthCheck();
    assert.equal(health.ok, false);
    assert.equal(health.blocked, true);
    assert.equal(health.message, "guazi_source_blocked_bot_challenge");
    assert.equal(health.httpStatus, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
