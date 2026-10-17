import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { autoPapaDetailPriceUsd, autoPapaExactDetailFacts, autoPapaSellerDeclaredPriceUsd, autoPapaStructuredPrimaryPriceUsd } from "../apps/web/lib/catalog/autopapa-georgia-source";
import type { VehicleOffer } from "../apps/web/lib/catalog/types";

const markup = `<html><body><div>Hyundai Kona $4 938</div><div>STARTING PRICE AT A REDUCTION IN GEORGIA $6 314</div><div>Body Type: SUV Power: 149 hp</div><div>Car description</div><section>More details VIN : KM8K22AB4PU044726 Cena : 12900 $, 2023 god 4 mesac, prabeg : 27 000 kilometer</section><a>let me know when a car like this is found</a></body></html>`;

test("seller Cena overrides teaser", () => {
  assert.equal(autoPapaSellerDeclaredPriceUsd(markup), 12900);
  assert.equal(autoPapaStructuredPrimaryPriceUsd(markup, { make: "Hyundai", model: "Kona" }), 4938);
  assert.equal(autoPapaDetailPriceUsd(markup, { make: "Hyundai", model: "Kona" }), 12900);
});

test("958003 facts record seller authority", () => {
  const offer = { sourceId: "autopapa_georgia_open", sourceOfferId: "958003", make: "Hyundai", model: "Kona", powertrainKind: "combustion", operational: { sourceUrl: "https://autopapa.ge/en/usd/hyundai/kona/958003" } } as VehicleOffer;
  const facts = autoPapaExactDetailFacts(offer, markup, "https://autopapa.ge/en/usd/hyundai/kona/958003");
  assert.ok(facts);
  assert.equal(facts.priceUsd, 12900);
  assert.equal(facts.priceAuthority, "seller_declared_cena");
});

test("V3 rejects unverified retained AutoPapa prices", () => {
  const rebuild = fs.readFileSync(new URL("../scripts/catalog-rebuild-source-shard.mjs", import.meta.url), "utf8");
  const validator = fs.readFileSync(new URL("../scripts/catalog-validate-source-scale.mjs", import.meta.url), "utf8");
  assert.match(rebuild, /function hasVerifiedAutoPapaPrice/);
  assert.match(rebuild, /reject\("source_detail_price"\)/);
  assert.match(validator, /requiredFreshUnproductiveSourceIds/);
});
