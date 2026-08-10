from pathlib import Path
import re


def replace_once(text, old, new, label):
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"{label}: marker not found")
    return text.replace(old, new, 1)

# 1) Customs engine: calculate every legally known pure-EV component even when utilization power is absent.
p = Path("packages/engine/src/calculation/russiaCustoms.ts")
text = p.read_text()
old = '''function pureElectricCustomsPayment(input: RussiaCustomsInput, customsValueRub: number, utilizationPowerKw: number) {
  const excisePowerKw = positive(input.powerKw)
    || (positive(input.powerHp) ? Number(input.powerHp) * 0.75 : undefined)
    || utilizationPowerKw;
  const excisePowerHp = positive(input.powerHp) || excisePowerKw / 0.75;
  const importDutyRub = Math.round(customsValueRub * EV_IMPORT_DUTY_RATE);
  const exciseRub = Math.round(excisePowerHp * exciseRateRubPerHp2026(excisePowerKw));
  const vatRub = Math.round((customsValueRub + importDutyRub + exciseRub) * VAT_RATE_2026);
  return { importDutyRub, exciseRub, vatRub };
}
'''
new = '''function pureElectricKnownCustomsPayment(input: RussiaCustomsInput, customsValueRub: number) {
  const excisePowerKw = positive(input.powerKw)
    || (positive(input.powerHp) ? Number(input.powerHp) * 0.75 : undefined);
  const importDutyRub = Math.round(customsValueRub * EV_IMPORT_DUTY_RATE);
  if (!excisePowerKw) {
    // We can still calculate the exact 15% duty and the VAT base that does not
    // depend on excise. The unknown excise and its incremental VAT stay excluded
    // from the preliminary lower-bound price until source/certified power is known.
    const vatRub = Math.round((customsValueRub + importDutyRub) * VAT_RATE_2026);
    return { importDutyRub, exciseRub: 0, vatRub, excisePowerKnown: false };
  }
  const excisePowerHp = positive(input.powerHp) || excisePowerKw / 0.75;
  const exciseRub = Math.round(excisePowerHp * exciseRateRubPerHp2026(excisePowerKw));
  const vatRub = Math.round((customsValueRub + importDutyRub + exciseRub) * VAT_RATE_2026);
  return { importDutyRub, exciseRub, vatRub, excisePowerKnown: true };
}
'''
text = replace_once(text, old, new, "EV known customs helper")
old = '''  if (!utilizationPowerKw) missing.push(
    powertrainKind === "electric" || powertrainKind === "series_hybrid"
      ? "certified_30_minute_power_kw" : "utilization_power_kw",
  );
  if (needsCombustionDisplacement && !engineCc) missing.push("engine_cc");
'''
new = '''  if (!utilizationPowerKw) missing.push(
    powertrainKind === "electric" || powertrainKind === "series_hybrid"
      ? "certified_30_minute_power_kw" : "utilization_power_kw",
  );
  if (pureElectric && !positive(input.powerKw) && !positive(input.powerHp)) missing.push("electric_excise_power_kw");
  if (needsCombustionDisplacement && !engineCc) missing.push("engine_cc");
'''
text = replace_once(text, old, new, "EV excise missing marker")
old = '''    if (customsValueRub && pureElectric && utilizationPowerKw) {
      ({ importDutyRub, exciseRub, vatRub } = pureElectricCustomsPayment(input, customsValueRub, utilizationPowerKw));
    } else if (customsValueEur && eurRateRub && engineCc && !pureElectric) {
'''
new = '''    if (customsValueRub && pureElectric) {
      ({ importDutyRub, exciseRub, vatRub } = pureElectricKnownCustomsPayment(input, customsValueRub));
    } else if (customsValueEur && eurRateRub && engineCc && !pureElectric) {
'''
text = replace_once(text, old, new, "EV customs calculation without utilization power")
old = '''  if ((powertrainKind === "electric" || powertrainKind === "series_hybrid") && !utilizationPowerKw) warnings.push(
    "Нужна максимальная 30-минутная мощность из ОТТС, СБКТС, ЗОЕТС или ЭПТС; пиковая мощность для утильсбора не используется.",
  );
'''
new = '''  if ((powertrainKind === "electric" || powertrainKind === "series_hybrid") && !utilizationPowerKw) warnings.push(
    "Нужна максимальная 30-минутная мощность из ОТТС, СБКТС, ЗОЕТС или ЭПТС; пиковая мощность для утильсбора не используется. До её получения утильсбор не включается в предварительный итог.",
  );
  if (pureElectric && !positive(input.powerKw) && !positive(input.powerHp)) warnings.push(
    "Мощность электродвигателя для акциза не подтверждена источником: акциз и зависящая от него часть НДС не включены в предварительный итог.",
  );
'''
text = replace_once(text, old, new, "EV preliminary warnings")
p.write_text(text)

# 2) Central catalog calculator: power-only missing data becomes truthful preliminary pricing.
p = Path("apps/web/lib/catalog/customs-pricing.ts")
text = p.read_text()
start = text.index("export async function calculateOfferWithRussiaCustoms")
helper = '''const PRELIMINARY_POWER_MISSING = new Set([
  "certified_30_minute_power_kw",
  "utilization_power_kw",
  "utilization_coefficient",
  "ice_power_kw",
  "electric_excise_power_kw",
]);

function isElectrifiedKind(value: unknown) {
  return ["electric", "series_hybrid", "other_hybrid"].includes(String(value || ""));
}

function onlyPowerDependentMissing(values: unknown) {
  const rows = Array.isArray(values) ? values.map(String).filter(Boolean) : [];
  return rows.length > 0 && rows.every((value) => PRELIMINARY_POWER_MISSING.has(value));
}

export function isPreliminaryElectrifiedCalculation(offer: Partial<VehicleOffer> | any) {
  const snapshot = offer?.calculationSnapshot || {};
  const customs = snapshot.customs || {};
  return isElectrifiedKind(offer?.powertrainKind)
    && String(offer?.calculationStatus || "") === "preliminary_power_pending"
    && positive(offer?.totalRub) > 0
    && snapshot.pricingConfidence === "preliminary"
    && snapshot.priceIncludesUtilizationFee === false
    && customs.status === "needs_data"
    && onlyPowerDependentMissing(snapshot.missing || customs.missing);
}

'''
new_fn = r'''export async function calculateOfferWithRussiaCustoms(input: VehicleOffer): Promise<VehicleOffer> {
  const canonical = await enrichOfferWithVehicleKnowledge(enrichOfferWithExplicitEngineDisplacement(input));
  const certified = await enrichOfferWithCertifiedPower(canonical);
  const known = await enrichOfferWithPowerKnowledge(certified);
  const normalized = preferExplicitCombustionPowertrain(normalizeVehicleOfferSpecs(known) as VehicleOffer) as VehicleOffer;
  const electrified = isElectrifiedKind(normalized.powertrainKind);
  const offer = electrified && positive(normalized.utilizationPowerKw) && !hasTrustedUtilizationPower(normalized)
    ? { ...normalized, utilizationPowerKw: undefined }
    : normalized;

  const rate = await convertToRub(offer.sourcePrice, offer.sourceCurrency);
  if (!rate) {
    return {
      ...offer,
      totalRub: null,
      calculationStatus: "needs_currency_rate",
      calculationSnapshot: {
        ...(offer.calculationSnapshot || {}),
        pricingConfidence: "unavailable",
        customs: { status: "needs_data", missing: ["source_currency_rate"] },
      },
    };
  }

  const pendingSnapshot = {
    ...(offer.calculationSnapshot || {}),
    currencyRate: rate,
    sourcePriceRub: rate.sourcePriceRub,
  };

  // Missing ordinary combustion power still blocks a calculated public price.
  // Electrified vehicles are different: missing short-term/utilization power may
  // produce a clearly marked preliminary lower-bound instead of disappearing.
  if (!electrified && !positive(offer.powerHp)) {
    return {
      ...offer,
      totalRub: null,
      calculationStatus: "needs_power_data",
      calculationSnapshot: {
        ...pendingSnapshot,
        pricingConfidence: "unavailable",
        missing: ["power_hp"],
        warnings: ["Автомобиль не публикуется как рассчитанный, пока мощность не найдена в объявлении или базе модели/модификации. Рублёвый эквивалент цены источника при этом сохраняется."],
      },
    };
  }

  const eurRate = await convertToRub(1, "EUR");
  if (!eurRate) {
    return {
      ...offer,
      totalRub: null,
      calculationStatus: "needs_currency_rate",
      calculationSnapshot: {
        ...pendingSnapshot,
        customs: { status: "needs_data", missing: ["eur_rate"] },
        pricingConfidence: "unavailable",
      },
    };
  }

  const borderTransportRub = transportToBorderRub(offer);
  const customsValueRub = rate.sourcePriceRub + borderTransportRub;
  const customs = calculateRussiaCustomsForIndividual({
    customsValueRub,
    eurRateRub: Number(eurRate.effectiveRate || 0),
    engineCc: offer.engineCc,
    powerHp: offer.powerHp,
    powerKw: offer.powerKw,
    icePowerKw: offer.icePowerKw,
    power30MinKw: documentedMotorPower(offer) ? offer.power30MinKw : undefined,
    power30MinKwByMotor: documentedMotorPower(offer) && Array.isArray(offer.power30MinKwByMotor) ? offer.power30MinKwByMotor : undefined,
    utilizationPowerKw: hasTrustedUtilizationPower(offer) ? offer.utilizationPowerKw : undefined,
    powertrainKind: offer.powertrainKind,
    productionDate: offer.productionDate,
    year: offer.year,
    fuel: offer.fuel,
  });

  const configured: any = await getActiveMarketVersion(offer.market);
  const market = resolveCatalogMarketConfig(offer.market, configured);
  const utilizationProblem = exactUtilizationPowerProblem(offer);
  const combinedMissing = [...new Set([
    ...(utilizationProblem?.missing || []),
    ...(Array.isArray(customs.missing) ? customs.missing : []),
  ])];

  if (electrified && onlyPowerDependentMissing(combinedMissing) && positive(customs.knownCustomsRub) > 0) {
    const calculation = calculateAvtocenaFromBusinessConfig({
      marketId: offer.market,
      marketConfig: market.config,
      sourcePriceRub: rate.sourcePriceRub,
      customsRub: customs.knownCustomsRub,
    });
    const excludedPriceItems = [
      ...(combinedMissing.some((item) => ["certified_30_minute_power_kw", "utilization_power_kw", "utilization_coefficient", "ice_power_kw"].includes(item)) ? ["utilization-fee"] : []),
      ...(combinedMissing.includes("electric_excise_power_kw") ? ["excise", "vat-excise-increment"] : []),
    ];
    const warning = "Предварительный расчёт: включены только подтверждённые на данный момент платежи. Компоненты, зависящие от недостающей мощности, не включены; финальную сумму подтвердит менеджер.";
    return {
      ...offer,
      priceMode: offer.priceMode === "auction_start" ? "auction_start" : "estimated",
      totalRub: calculation.totalRub,
      calculationSnapshot: {
        ...calculation.snapshot,
        currencyRate: rate,
        sourcePriceRub: rate.sourcePriceRub,
        customs,
        customsValue: customsValueSnapshot(rate, borderTransportRub, customsValueRub),
        customsCompleteness: "needs_data",
        marketConfigStatus: configured?.status || "missing",
        pricingConfidence: "preliminary",
        preliminary: true,
        preliminaryKnownCustomsRub: customs.knownCustomsRub,
        priceIncludesUtilizationFee: false,
        priceIncludesAllCustoms: false,
        excludedPriceItems,
        missing: combinedMissing,
        estimatedMarketFields: market.estimatedFields,
        powerConfidence: offer.powerDataConfidence,
        powerSource: offer.powerDataSource,
        certified30MinutePowerMissing: combinedMissing.includes("certified_30_minute_power_kw"),
        vehicleKnowledge: (offer.operational?.raw as any)?.vehicleKnowledgeModel || null,
        warnings: [...market.warnings, ...customs.warnings, ...(utilizationProblem ? [utilizationProblem.warning] : []), warning],
      },
      calculationStatus: "preliminary_power_pending",
    };
  }

  if (customs.status !== "ready" || customs.totalCustomsRub === undefined) {
    return {
      ...offer,
      totalRub: null,
      calculationSnapshot: {
        ...pendingSnapshot,
        customs,
        customsValue: customsValueSnapshot(rate, borderTransportRub, customsValueRub),
        customsCompleteness: customs.status,
        marketConfigStatus: configured?.status || "missing",
        pricingConfidence: "unavailable",
        estimatedMarketFields: market.estimatedFields,
        certified30MinutePowerMissing: customs.missing.includes("certified_30_minute_power_kw"),
        missing: combinedMissing,
        warnings: [...market.warnings, ...customs.warnings, ...(utilizationProblem ? [utilizationProblem.warning] : [])],
      },
      calculationStatus: utilizationProblem ? "needs_utilization_power" : "needs_customs_data",
    };
  }

  const calculation = calculateAvtocenaFromBusinessConfig({
    marketId: offer.market,
    marketConfig: market.config,
    sourcePriceRub: rate.sourcePriceRub,
    customsRub: customs.totalCustomsRub,
  });

  const powerEstimated = ["reference", "estimated"].includes(String(offer.powerDataConfidence || ""));
  const priceEstimated = market.estimated || powerEstimated || customs.ageEstimated || offer.priceMode === "estimated";
  const warnings = [
    ...market.warnings,
    ...customs.warnings,
    ...(powerEstimated ? ["Мощность подставлена по базе модели/модификации и должна быть подтверждена менеджером по конкретному автомобилю."] : []),
  ];

  return {
    ...offer,
    priceMode: priceEstimated && offer.priceMode !== "auction_start" ? "estimated" : offer.priceMode,
    totalRub: calculation.totalRub,
    calculationSnapshot: {
      ...calculation.snapshot,
      currencyRate: rate,
      sourcePriceRub: rate.sourcePriceRub,
      customs,
      customsValue: customsValueSnapshot(rate, borderTransportRub, customsValueRub),
      customsCompleteness: customs.status,
      pricingConfidence: priceEstimated ? "estimated" : "exact",
      estimatedMarketFields: market.estimatedFields,
      powerConfidence: offer.powerDataConfidence,
      powerSource: offer.powerDataSource,
      certified30MinutePowerMissing: false,
      priceIncludesUtilizationFee: true,
      priceIncludesAllCustoms: true,
      vehicleKnowledge: (offer.operational?.raw as any)?.vehicleKnowledgeModel || null,
      warnings,
    },
    calculationStatus: offer.priceMode === "auction_start"
      ? "auction_start"
      : priceEstimated
        ? "estimated"
        : "ready",
  };
}
'''
text = text[:start] + helper + new_fn
p.write_text(text)

# 3) Public priority: preliminary electrified totals are visible but ranked below exact totals.
p = Path("apps/web/lib/catalog/public-priority.ts")
text = p.read_text()
text = replace_once(text,
'''  calculated: boolean;
  imageCount: number;
''',
'''  calculated: boolean;
  preliminary: boolean;
  imageCount: number;
''', "priority type preliminary")
marker = '''function regionalPhotoIdentityVerified(offer: Partial<VehicleOffer> | any) {'''
helper2 = '''function preliminaryElectrifiedCalculation(offer: Partial<VehicleOffer> | any) {
  const totalRub = positive(offer?.totalRub, 1_000_000_000);
  const kind = String(offer?.powertrainKind || "");
  const snapshot = offer?.calculationSnapshot || {};
  const customs = snapshot.customs || {};
  const breakdown = Array.isArray(snapshot.breakdown) ? snapshot.breakdown : [];
  const hasCar = breakdown.some((line: any) => String(line?.id || "") === "car" && positive(line?.amountRub) > 0);
  const hasKnownCustoms = breakdown.some((line: any) => String(line?.id || "") === "customs" && positive(line?.amountRub) > 0);
  return Boolean(totalRub
    && ["electric", "series_hybrid", "other_hybrid"].includes(kind)
    && String(offer?.calculationStatus || "") === "preliminary_power_pending"
    && snapshot.pricingConfidence === "preliminary"
    && snapshot.priceIncludesUtilizationFee === false
    && customs.status === "needs_data"
    && hasCar && hasKnownCustoms);
}

'''
if helper2 not in text:
    text = text.replace(marker, helper2 + marker, 1)
text = text.replace('''export function catalogOfferVisibleRub(offer: Partial<VehicleOffer> | any) {
  if (!completeCalculation(offer)) return 0;
''','''export function catalogOfferVisibleRub(offer: Partial<VehicleOffer> | any) {
  if (!completeCalculation(offer) && !preliminaryElectrifiedCalculation(offer)) return 0;
''')
start = text.index("export function catalogPublicPriority")
end = text.index("export function compareCatalogPublicPriority", start)
new_priority = r'''export function catalogPublicPriority(offer: Partial<VehicleOffer> | any): CatalogPublicPriority {
  const japanAuction = isJapanAuctionOffer(offer);
  const calculated = completeCalculation(offer);
  const preliminary = preliminaryElectrifiedCalculation(offer);
  const visibleRub = catalogOfferVisibleRub(offer);
  const ageYears = offerAgeYears(offer);
  const powerHp = offerPowerHp(offer);
  const popularityDecile = knowledgePopularityDecile(offer);
  const imageCount = Array.isArray(offer?.images) ? offer.images.length : 0;
  const { preferredMaximumRub, absoluteMaximumRub } = publicPriceLimits();
  const maximumPowerHp = Math.max(50, Number(process.env.CATALOG_PRIORITY_MAX_POWER_HP || 160));
  const maximumAgeYears = Math.max(1, Number(process.env.CATALOG_PRIORITY_MAX_AGE_YEARS || 6));
  const popularDecile = Math.max(1, Math.min(10, Number(process.env.CATALOG_PRIORITY_POPULARITY_DECILE || 5)));
  const rawTotalRub = Math.round(positive(offer?.totalRub, 1_000_000_000));
  const base = { visibleRub, ageYears, powerHp, popularityDecile, calculated, preliminary, imageCount, japanAuction };

  if (!calculated && !preliminary) return { eligible: false, tier: 99, reason: "missing_full_calculation", ...base };
  if (!regionalPhotoIdentityVerified(offer)) return { eligible: false, tier: 99, reason: "unverified_regional_photo_identity", ...base };
  if (!rawTotalRub) return { eligible: false, tier: 99, reason: "missing_ruble_price", ...base };
  if (rawTotalRub > absoluteMaximumRub) return { eligible: false, tier: 99, reason: "above_absolute_price_limit", ...base };
  if (!visibleRub) return { eligible: false, tier: 99, reason: "missing_ruble_price", ...base };

  if (preliminary) {
    return { eligible: true, tier: rawTotalRub <= preferredMaximumRub ? 8 : 9, reason: "preliminary_electrified_power_pending", ...base };
  }

  const recent = ageYears <= maximumAgeYears;
  const economicalPower = powerHp > 0 && powerHp <= maximumPowerHp;
  const popular = popularityDecile <= popularDecile;
  const preferredPrice = rawTotalRub <= preferredMaximumRub;
  let tier = preferredPrice ? 6 : 7;
  let reason = japanAuction ? "japan_auction_calculated" : preferredPrice ? "calculated_under_preferred_price" : "calculated_above_preferred_price";
  if (preferredPrice && recent && economicalPower && popular) { tier = 1; reason = "popular_recent_economical_calculated"; }
  else if (preferredPrice && recent && economicalPower) { tier = 2; reason = "recent_economical_calculated"; }
  else if (preferredPrice && popular) { tier = 3; reason = "popular_calculated"; }
  else if (japanAuction && preferredPrice) { tier = 4; reason = "japan_auction_calculated"; }
  return { eligible: true, tier, reason, ...base };
}

'''
text = text[:start] + new_priority + text[end:]
p.write_text(text)

# 4) Price label and offer-page warning.
p = Path("apps/web/components/catalog/CatalogPrice.tsx")
text = p.read_text()
text = text.replace('''  if (totalRub > 0) {
    return <PriceTrend offer={offer} label={label} dense={dense} priceClassName={priceClassName} />;
  }
''','''  if (totalRub > 0) {
    const preliminary = String(offer?.calculationStatus || "") === "preliminary_power_pending"
      || offer?.calculationSnapshot?.pricingConfidence === "preliminary";
    return <PriceTrend offer={offer} label={preliminary ? "Предварительно от" : label} dense={dense} priceClassName={priceClassName} />;
  }
''')
p.write_text(text)

p = Path("apps/web/app/(public)/cars/offer/[id]/page.tsx")
text = p.read_text()
old = '''          <PriceTrend offer={o} label="Ориентир стоимости" priceClassName="text-3xl md:text-4xl" className="ac-offer-price-panel" panel />
          {o.priceMode === "auction_start" ? <p className="mt-2 rounded-2xl bg-amber-400/10 p-3 text-sm font-bold text-amber-200">Расчёт сделан от стартовой цены. Финальная стоимость аукциона может измениться.</p> : null}
'''
new = '''          <PriceTrend offer={o} label={String(raw?.calculationStatus || "") === "preliminary_power_pending" ? "Предварительно от" : "Ориентир стоимости"} priceClassName="text-3xl md:text-4xl" className="ac-offer-price-panel" panel />
          {String(raw?.calculationStatus || "") === "preliminary_power_pending" ? <p className="mt-2 rounded-2xl bg-amber-400/10 p-3 text-sm font-bold leading-5 text-amber-200">Предварительный расчёт: платежи, зависящие от неподтверждённой мощности электромотора/гибридной системы, пока не включены. Финальную стоимость подтвердит менеджер.</p> : null}
          {o.priceMode === "auction_start" ? <p className="mt-2 rounded-2xl bg-amber-400/10 p-3 text-sm font-bold text-amber-200">Расчёт сделан от стартовой цены. Финальная стоимость аукциона может измениться.</p> : null}
'''
text = replace_once(text, old, new, "offer preliminary warning")
p.write_text(text)

# 5) Recovery collectors: accept exact OR power-only preliminary electrified calculation.
collector_paths = [
    "scripts/catalog-live-recovery-market.mjs",
    "scripts/catalog-live-recovery-japan-prestige.mjs",
    "scripts/catalog-live-recovery-direct-exact.mjs",
    "scripts/catalog-live-recovery-kyrgyzstan-direct.mjs",
    "scripts/catalog-live-recovery-europe-otomoto.mjs",
]
for path in collector_paths:
    p = Path(path)
    text = p.read_text()
    old_import = 'const { calculateOfferWithRussiaCustoms } = await import("../apps/web/lib/catalog/customs-pricing.ts");'
    new_import = 'const { calculateOfferWithRussiaCustoms, isPreliminaryElectrifiedCalculation } = await import("../apps/web/lib/catalog/customs-pricing.ts");'
    text = text.replace(old_import, new_import)
    # Generic acceptance line in all current recovery scripts.
    text = text.replace('''    if (!exactCalculation(calculated)) { reject(rejections, "calculation_pending"); continue; }''', '''    if (!exactCalculation(calculated) && !isPreliminaryElectrifiedCalculation(calculated)) { reject(rejections, "calculation_pending"); continue; }''')
    text = text.replace('''  if (!exactCalculation(calculated)) { reject("calculation_pending"); return null; }''', '''  if (!exactCalculation(calculated) && !isPreliminaryElectrifiedCalculation(calculated)) { reject("calculation_pending"); return null; }''')
    # Mark preliminary rows for audit while keeping source binding flags.
    text = text.replace('''        recoveryCalculatedRub: true,
        recoveryBodySourceOnly: true,''', '''        recoveryCalculatedRub: true,
        recoveryPreliminaryPowerPending: isPreliminaryElectrifiedCalculation(calculated),
        recoveryBodySourceOnly: true,''')
    # Add report count beside calculatedCount wherever present.
    text = text.replace('''  calculatedCount: offers.filter(exactCalculation).length,
''', '''  calculatedCount: offers.filter(exactCalculation).length,
  preliminaryCount: offers.filter(isPreliminaryElectrifiedCalculation).length,
''')
    p.write_text(text)

# 6) Publisher: retain and publish both exact and explicit preliminary electrified totals.
p = Path("scripts/catalog-live-recovery-publish.mjs")
text = p.read_text()
insert = 'const { isPreliminaryElectrifiedCalculation } = await import("../apps/web/lib/catalog/customs-pricing.ts");\n'
if insert not in text:
    anchor = 'const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");\n'
    text = text.replace(anchor, anchor + insert, 1)
marker = '''function exactSourceBound(offer) {'''
helper3 = '''function publishableCalculation(offer) {
  return exactCalculation(offer) || isPreliminaryElectrifiedCalculation(offer);
}
'''
if helper3 not in text:
    text = text.replace(marker, helper3 + marker, 1)
text = text.replace('''    && exactCalculation(offer)
    && isCatalogOfferBusinessLiquid(offer);''','''    && publishableCalculation(offer)
    && isCatalogOfferBusinessLiquid(offer);''')
text = text.replace('''  if (!exactCalculation(offer)) { reject("calculation"); continue; }''','''  if (!publishableCalculation(offer)) { reject("calculation"); continue; }''')
text = text.replace('''  calculatedCount: marketRows.filter(exactCalculation).length,
''','''  calculatedCount: marketRows.filter(exactCalculation).length,
  preliminaryCount: marketRows.filter(isPreliminaryElectrifiedCalculation).length,
''')
p.write_text(text)

print("preliminary electrified patch applied")
