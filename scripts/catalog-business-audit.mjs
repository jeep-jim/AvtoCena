import fs from "node:fs/promises";

const { getEffectiveMarketsWithDefaults } = await import("../apps/web/lib/effective-market-settings.ts");
const { readVehicleKnowledgeModels, readVehicleKnowledgeVariants } = await import("../apps/web/lib/catalog/vehicle-knowledge.ts");
const { calculateAvtocenaFromBusinessConfig } = await import("../packages/engine/src/calculation/calculateAvtocena.ts");
const { calculateRussiaCustomsForIndividual } = await import("../packages/engine/src/calculation/russiaCustoms.ts");

const outputFile = process.env.CATALOG_BUSINESS_AUDIT_REPORT || "catalog-business-audit-report.json";
const minimumKnowledgeRecords = Math.max(1, Number(process.env.CATALOG_MIN_KNOWLEDGE_RECORDS || 6_800));
const requiredMarkets = ["japan", "china", "korea", "uae", "europe", "georgia"];
const requiredAmounts = [
  "securityDepositRub", "topAvtoCommissionRub", "contractInitialPaymentRub",
  "exportExpensesRub", "logisticsRub", "brokerRub", "svhRub", "laboratoryRub",
  "sbktsRub", "eptsRub", "rfDeliveryRub", "otherFixedExpensesRub", "exchangeRateReservePercent",
];

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0;
}

function sumBreakdown(result) {
  return (result.breakdown || []).reduce((sum, line) => sum + Number(line.amountRub || 0), 0);
}

function customsScenario(id, input) {
  const result = calculateRussiaCustomsForIndividual(input);
  const breakdownTotal = sumBreakdown(result);
  const ok = result.status === "ready"
    && Number.isFinite(Number(result.totalCustomsRub))
    && Number(result.totalCustomsRub) === breakdownTotal
    && Number(result.utilizationFeeRub) >= 0;
  return {
    id,
    ok,
    status: result.status,
    totalCustomsRub: result.totalCustomsRub,
    utilizationPowerKw: result.utilizationPowerKw,
    utilizationCoefficient: result.utilizationCoefficient,
    utilizationFeeRub: result.utilizationFeeRub,
    missing: result.missing,
    warnings: result.warnings,
    breakdownTotal,
  };
}

const errors = [];
const warnings = [];
let markets = [];
let models = [];
let variants = [];

try {
  markets = await getEffectiveMarketsWithDefaults();
} catch (error) {
  errors.push(`market_settings_read:${String(error?.message || error)}`);
}
try {
  [models, variants] = await Promise.all([readVehicleKnowledgeModels(), readVehicleKnowledgeVariants()]);
} catch (error) {
  errors.push(`vehicle_knowledge_read:${String(error?.message || error)}`);
}

const marketAudit = {};
for (const marketId of requiredMarkets) {
  const market = markets.find((row) => row.id === marketId);
  const version = market?.effectiveVersion;
  const missingFields = requiredAmounts.filter((field) => !finiteNonNegative(version?.[field]));
  const initialPaymentMinimum = Number(version?.securityDepositRub || 0) + Number(version?.topAvtoCommissionRub || 0);
  const initialPaymentOk = Number(version?.contractInitialPaymentRub || 0) >= initialPaymentMinimum;
  const active = Boolean(version && version.status === "active" && version.active !== false);
  const ok = active && !missingFields.length && initialPaymentOk && Boolean(version?.currency);
  marketAudit[marketId] = {
    ok,
    active,
    configVersion: version?.id,
    provisional: Boolean(version?.provisional),
    currency: version?.currency,
    missingFields,
    initialPaymentRub: Number(version?.contractInitialPaymentRub || 0),
    initialPaymentMinimum,
  };
  if (!ok) errors.push(`${marketId}:market_profile_invalid`);
}

const importedAt = new Date("2026-07-27T00:00:00.000Z");
const customsScenarios = [
  customsScenario("combustion_1500_personal", {
    customsValueRub: 1_500_000, eurRateRub: 100, engineCc: 1_500, powerHp: 110,
    powertrainKind: "combustion", productionDate: "2023-01", importedAt,
  }),
  customsScenario("electric_documented_30min", {
    customsValueRub: 2_000_000, eurRateRub: 100, powerHp: 204, powerKw: 150,
    power30MinKw: 50, powertrainKind: "electric", productionDate: "2025-01", importedAt,
  }),
  customsScenario("series_hybrid_documented_30min", {
    customsValueRub: 2_200_000, eurRateRub: 100, engineCc: 1_500, powerHp: 218,
    power30MinKw: 45, powertrainKind: "series_hybrid", productionDate: "2025-01", importedAt,
  }),
  customsScenario("parallel_hybrid_ice_plus_30min", {
    customsValueRub: 2_200_000, eurRateRub: 100, engineCc: 1_500, powerHp: 218,
    icePowerKw: 80, power30MinKw: 30, powertrainKind: "other_hybrid", productionDate: "2025-01", importedAt,
  }),
];
if (customsScenarios.some((row) => !row.ok)) errors.push("customs_or_utilization_scenario_failed");

const incompleteElectric = calculateRussiaCustomsForIndividual({
  customsValueRub: 2_000_000, eurRateRub: 100, powerKw: 180,
  powertrainKind: "electric", productionDate: "2025-01", importedAt,
});
const peakPowerGuardOk = incompleteElectric.status === "needs_data"
  && incompleteElectric.missing.includes("certified_30_minute_power_kw")
  && incompleteElectric.totalCustomsRub === undefined;
if (!peakPowerGuardOk) errors.push("peak_power_substitution_guard_failed");

const businessCalculationChecks = [];
for (const market of markets) {
  const version = market.effectiveVersion;
  if (!version) continue;
  const result = calculateAvtocenaFromBusinessConfig({
    marketId: market.id,
    marketConfig: version,
    sourcePriceRub: 1_000_000,
    customsRub: 500_000,
  });
  const breakdownTotal = sumBreakdown(result);
  const deposit = result.breakdown.find((line) => line.id === "security-deposit");
  const car = result.breakdown.find((line) => line.id === "car");
  const depositNotDoubleCounted = Number(deposit?.amountRub || 0) + Number(car?.amountRub || 0) === 1_000_000;
  const ok = result.totalRub === breakdownTotal && depositNotDoubleCounted;
  businessCalculationChecks.push({ market: market.id, ok, totalRub: result.totalRub, breakdownTotal, depositNotDoubleCounted });
  if (!ok) errors.push(`${market.id}:business_calculation_invariant_failed`);
}

const knowledge = {
  models: models.length,
  variants: variants.length,
  totalRecords: models.length + variants.length,
  minimumRecords: minimumKnowledgeRecords,
  targetReached: models.length + variants.length >= minimumKnowledgeRecords,
  activeModels: models.filter((row) => row.active !== false).length,
  activeVariants: variants.filter((row) => row.active !== false).length,
};
if (!knowledge.targetReached) warnings.push(`vehicle_knowledge_${knowledge.totalRecords}_below_${minimumKnowledgeRecords}`);
if (!models.length) errors.push("vehicle_knowledge_models_empty");
if (!variants.length) warnings.push("vehicle_knowledge_variants_empty");

const report = {
  version: 23,
  checkedAt: new Date().toISOString(),
  ruleVersion: "rf_personal_m1_2026-01-01",
  marketAudit,
  knowledge,
  customsScenarios,
  peakPowerGuardOk,
  businessCalculationChecks,
  warnings,
  errors,
  publicationSafe: errors.length === 0,
};

await fs.writeFile(outputFile, JSON.stringify(report, null, 2));
if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(process.env.GITHUB_OUTPUT, `publication_safe=${report.publicationSafe}\n`);
  await fs.appendFile(process.env.GITHUB_OUTPUT, `knowledge_records=${knowledge.totalRecords}\n`);
}
console.log(JSON.stringify(report, null, 2));
