import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { autoPapaDetailPriceUsd } from "../apps/web/lib/catalog/autopapa-georgia-source";

const rebuild = fs.readFileSync(new URL("../scripts/catalog-rebuild-source-shard.mjs", import.meta.url), "utf8");

test("AutoPapa current detail markup can bind the primary asking price without an H1", () => {
  const markup = `
    <div>Home / Hyundai / Kona / Hyundai Kona, 2023 (#958003)</div>
    <div class="vehicle-title">Hyundai Kona</div>
    <span class="vehicle-price">$4 938</span>
    <div>STARTING PRICE AT A REDUCTION IN GEORGIA, INCLUDING CUSTOMS CLEARANCE (BARGAINING) $6 314</div>
    <div>STARTING PRICE IN GEORGIA INCLUDING CUSTOMS CLEARANCE $6 130</div>
    <div>Body Type: SUV Power: Engine Vol: 2.0 l</div>
    <div>Car description</div>
    <div>More details Cena : 12900 $</div>
    <aside>Top listings Hyundai Kona $12 700</aside>
  `;
  assert.equal(autoPapaDetailPriceUsd(markup, { make: "Hyundai", model: "Kona" } as any), 4_938);
});

test("AutoPapa cannot promote customs helper or seller-text prices when the primary price is absent", () => {
  const markup = `
    <div>Hyundai Kona</div>
    <div>STARTING PRICE AT A REDUCTION IN GEORGIA $6 314</div>
    <div>Body Type: SUV</div>
    <div>Car description Cena : 12900 $</div>
  `;
  assert.equal(autoPapaDetailPriceUsd(markup, { make: "Hyundai", model: "Kona" } as any), undefined);
});

test("V3 collector forces and verifies exact AutoPapa detail price before retaining or publishing", () => {
  assert.match(rebuild, /needsSourceDetailFactRefresh/);
  assert.match(rebuild, /const detailFactsNeeded = needsSourceDetailFactRefresh\(offer\)/);
  assert.match(rebuild, /mandatoryPhotoMissing \|\| criticalSpecsMissing \|\| priorityGalleryMissing \|\| detailFactsNeeded/);
  assert.match(rebuild, /function hasVerifiedAutoPapaPrice/);
  assert.match(rebuild, /autoPapaDetailPriceVerified === true/);
  assert.match(rebuild, /reject\("source_detail_price"\)/);
  assert.match(rebuild, /isCrediblePublicOffer\(offer\) && hasVerifiedAutoPapaPrice\(offer\)/);
});
