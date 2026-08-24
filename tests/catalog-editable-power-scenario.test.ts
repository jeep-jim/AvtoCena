import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { applyCatalogPowerScenario, DEFAULT_CATALOG_POWER_FALLBACK_HP, readCatalogPowerScenario, resolveCatalogPowerScenario } from "../apps/web/lib/catalog/power-scenario";
import { catalogOfferVisibleRub, catalogRequiredSpecificationRejectionReason } from "../apps/web/lib/catalog/public-priority";

const offerPage = fs.readFileSync(new URL("../apps/web/app/(public)/cars/offer/[id]/page.tsx", import.meta.url), "utf8");
const editableTile = fs.readFileSync(new URL("../apps/web/components/catalog/EditablePowerTile.tsx", import.meta.url), "utf8");
const catalogCard = fs.readFileSync(new URL("../apps/web/components/catalog/CatalogCard.tsx", import.meta.url), "utf8");
const customsPricing = fs.readFileSync(new URL("../apps/web/lib/catalog/customs-pricing.ts", import.meta.url), "utf8");

function base(overrides: Record<string, unknown> = {}) {
  return {
    id: "x", sourceId: "source", sourceOfferId: "1", market: "korea", status: "active",
    make: "Hyundai", model: "Avante", year: 2022, engineCc: 1598, powertrainKind: "combustion",
    sourcePrice: 10_000_000, sourceCurrency: "KRW", images: [], totalRub: null,
    calculationStatus: "needs_power_data", firstSeenAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    operational: { sourceUrl: "https://example.com/1" }, ...overrides,
  } as any;
}

test("missing power falls back to an explicit editable 100 hp scenario", () => {
  const scenario = resolveCatalogPowerScenario(base());
  assert.equal(scenario?.horsepower, DEFAULT_CATALOG_POWER_FALLBACK_HP);
  assert.equal(scenario?.source, "fallback_100");
  const applied = applyCatalogPowerScenario(base(), scenario!);
  assert.equal(applied.powerHp, 100);
  assert.equal(readCatalogPowerScenario(applied)?.requiresConfirmation, true);
  assert.equal(catalogRequiredSpecificationRejectionReason(applied), "");
});

test("exact combustion horsepower wins over the fallback", () => {
  assert.equal(resolveCatalogPowerScenario(base({ powerHp: 150 })), null);
});

test("customer horsepower overrides an automatic scenario", () => {
  const scenario = resolveCatalogPowerScenario(base({ powerHp: 150 }), { requestedHp: 130 });
  assert.equal(scenario?.source, "customer_input");
  const applied = applyCatalogPowerScenario(base({ powerHp: 150 }), scenario!);
  assert.equal(applied.powerHp, 130);
  assert.equal(Math.round(Number(applied.utilizationPowerKw)), 96);
});

test("a complete tagged scenario may expose only its explicitly estimated calculated total", () => {
  const scenario = applyCatalogPowerScenario(base(), resolveCatalogPowerScenario(base())!);
  const calculated = {
    ...scenario,
    totalRub: 2_500_000,
    publicVisibleRub: 2_500_000,
    cardProjectionVersion: 2,
    calculationStatus: "estimated",
    calculationSnapshot: {
      ...scenario.calculationSnapshot,
      pricingConfidence: "estimated",
      customs: { status: "ready" },
      breakdown: ["car","topavto-commission","broker","svh","laboratory","sbkts","epts","rf-delivery","customs"].map((id) => ({ id, amountRub: 1000 })),
    },
  };
  assert.equal(catalogOfferVisibleRub(calculated), 2_500_000);
});

test("power is the only editable offer specification on desktop and mobile", () => {
  assert.match(offerPage, /EditablePowerTile/);
  assert.match(offerPage, /calculateOfferWithUserPowerScenario/);
  assert.match(offerPage, /searchParams\?: Promise<\{ powerHp\?: string \}>/);
  assert.match(editableTile, /Выбрать мощность в лошадиных силах/);
  assert.match(editableTile, /Ввести мощность вручную/);
  assert.match(editableTile, /DEFAULT|100|fallback_100/);
  assert.match(catalogCard, /л\.с\. · уточнить/);
  assert.match(customsPricing, /powerRequiresConfirmation/);
});


test("customer-entered horsepower stays visible as an on-page preliminary calculation", () => {
  assert.match(offerPage, /const customerScenarioRub = safeRequestedPowerHp/);
  assert.match(offerPage, /powerScenario\?\.source === "customer_input"/);
  assert.match(offerPage, /customerScenarioRub \|\| catalogOfferVisibleRub\(raw\)/);
  assert.match(offerPage, /scenarioSource=\{powerScenario\?\.source \|\| null\} fullWidth/);
  assert.match(editableTile, /style=\{\{ gridColumn: "1 \/ -1" \}\}/);
});
