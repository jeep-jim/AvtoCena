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

test("missing power stays unresolved instead of becoming a public 100 hp scenario", () => {
  const scenario = resolveCatalogPowerScenario(base());
  assert.equal(scenario, null);
  assert.equal(DEFAULT_CATALOG_POWER_FALLBACK_HP, 100);
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

test("a customer scenario never becomes a publishable catalog total", () => {
  const scenario = applyCatalogPowerScenario(base(), resolveCatalogPowerScenario(base(), { requestedHp: 100 })!);
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
  assert.equal(catalogRequiredSpecificationRejectionReason(calculated), "unconfirmed_power_scenario");
  assert.equal(catalogOfferVisibleRub(calculated), 0);
});

test("a sourced real 100 hp combustion value remains eligible", () => {
  const sourced = base({ powerHp: 100, powerKw: 73.55, utilizationPowerKw: 73.55, powerDataSource: "marketplace detail:Power", powerDataConfidence: "source_exact" });
  assert.equal(catalogRequiredSpecificationRejectionReason(sourced), "");
});

test("an exact 100 hp value without provenance is rejected as legacy fallback", () => {
  assert.equal(catalogRequiredSpecificationRejectionReason(base({ powerHp: 100, powerKw: 73.55, utilizationPowerKw: 73.55 })), "unproven_exact_100_hp");
});

test("an electrified horsepower scenario cannot replace certified 30-minute power", () => {
  const electric = base({ powertrainKind: "electric", engineCc: undefined, fuel: "electric" });
  const scenario = applyCatalogPowerScenario(electric, resolveCatalogPowerScenario(electric, { requestedHp: 200 })!);
  assert.equal(scenario.utilizationPowerKw, undefined);
  assert.equal(catalogRequiredSpecificationRejectionReason(scenario), "unconfirmed_power_scenario");
});

test("power is the only editable offer specification on desktop and mobile", () => {
  assert.match(offerPage, /EditablePowerTile/);
  assert.match(offerPage, /calculateOfferWithUserPowerScenario/);
  assert.match(offerPage, /searchParams\?: Promise<\{ powerHp\?: string \}>/);
  assert.match(editableTile, /Выбрать или ввести мощность в лошадиных силах/);
  assert.match(editableTile, /setTimeout\(\(\) => commitManual\(value\), 500\)/);
  assert.doesNotMatch(editableTile, /type="submit"|Пересчитать по введённой мощности/);
  assert.doesNotMatch(editableTile, /status:\s*`(?:Расчёт по|Вы выбрали).*л\.с\./);
  assert.match(editableTile, /ac-filter-control ac-editable-power__control/);
  assert.match(editableTile, /ac-filter-option flex min-h-10/);
  assert.match(editableTile, /pointerdown/);
  assert.match(editableTile, /Boolean\(search\.get\("powerHp"\)\) && value === parsedManual\(\)/);
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
