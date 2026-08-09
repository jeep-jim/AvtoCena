from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one patch anchor, got {count}: {old[:160]!r}")
    p.write_text(text.replace(old, new, 1))


spec = "apps/web/lib/catalog/spec-normalization.ts"
replace_once(
    spec,
    'if (/phev|plug[ -]?in|hybrid|hev|mhev|reev|erev|range extender|гибрид|混合动力|增程|하이브리드/.test(text)) return "hybrid";',
    'if (/\\b(?:phev|hev|mhev|reev|erev)\\b|plug[ -]?in|hybrid|\\be[- ]?power\\b|range extender|гибрид|混合动力|增程|하이브리드/.test(text)) return "hybrid";',
)
replace_once(
    spec,
    'if (/series[ -]?hybrid|range[ -]?extender|\\b(?:reev|erev)\\b|последовательн\\w*\\s+гибрид|增程/.test(text)) return "series_hybrid";',
    'if (/series[ -]?hybrid|range[ -]?extender|\\be[- ]?power\\b|\\b(?:reev|erev)\\b|последовательн\\w*\\s+гибрид|增程/.test(text)) return "series_hybrid";',
)
replace_once(
    spec,
    '''  const powertrainKind = offer.powertrainKind && offer.powertrainKind !== "unknown"
    ? offer.powertrainKind
    : inferPowertrainKind(`${primary} ${full}`, engineCc);
  const thirtyMinute = exactThirtyMinutePowers(offer, full);''',
    '''  const explicitPowertrainKind = offer.powertrainKind && offer.powertrainKind !== "unknown" ? offer.powertrainKind : undefined;
  const primaryPowertrainKind = inferPowertrainKind(primary, engineCc);
  const fallbackPowertrainKind = primaryPowertrainKind !== "unknown" ? primaryPowertrainKind : inferPowertrainKind(full, engineCc);
  const inferredElectrified = ["electric", "series_hybrid", "other_hybrid"].includes(primaryPowertrainKind)
    ? primaryPowertrainKind
    : undefined;
  const powertrainKind = inferredElectrified || explicitPowertrainKind || fallbackPowertrainKind;
  if (powertrainKind === "electric") fuel = "electric";
  else if (["series_hybrid", "other_hybrid"].includes(powertrainKind)) fuel = "hybrid";
  else if (powertrainKind === "combustion" && fuel === "hybrid" && primaryPowertrainKind === "combustion") {
    fuel = inferFuel(primary.replace(/hybrid|\\b(?:phev|hev|mhev|reev|erev)\\b|\\be[- ]?power\\b/gi, " ")) || offer.fuel || inferFuel(full) || fuel;
  }
  const thirtyMinute = exactThirtyMinutePowers(offer, full);''',
)


generic = "scripts/catalog-live-recovery-market.mjs"
replace_once(
    generic,
    'const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");\n',
    'const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");\nconst { enrichOfferWithCertifiedPower } = await import("../apps/web/lib/catalog/power-reference.ts");\n',
)
replace_once(
    generic,
    '      offer = normalizeVehicleOfferSpecs(await safeVariantEnrich(offer));\n      let calculated;',
    '''      offer = normalizeVehicleOfferSpecs(await safeVariantEnrich(offer));
      if (["electric", "series_hybrid", "other_hybrid"].includes(String(offer.powertrainKind || ""))) {
        offer = normalizeVehicleOfferSpecs(await enrichOfferWithCertifiedPower(offer));
      }
      let calculated;''',
)
replace_once(
    generic,
    '  count: offers.length,\n  preferredCount,',
    '''  count: offers.length,
  electricCount: offers.filter((offer) => String(offer.powertrainKind || "") === "electric").length,
  hybridCount: offers.filter((offer) => ["series_hybrid", "other_hybrid"].includes(String(offer.powertrainKind || ""))).length,
  documentedPowerCount: offers.filter((offer) => String(offer.powerDataConfidence || "") === "documented").length,
  preferredCount,''',
)


europe = "scripts/catalog-live-recovery-europe-otomoto.mjs"
replace_once(
    europe,
    'const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");\n',
    'const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");\nconst { enrichOfferWithCertifiedPower } = await import("../apps/web/lib/catalog/power-reference.ts");\n',
)
replace_once(
    europe,
    '    offer = await fillOnlyUnambiguousSpecs(offer);\n    let calculated;',
    '''    offer = await fillOnlyUnambiguousSpecs(offer);
    if (["electric", "series_hybrid", "other_hybrid"].includes(String(offer.powertrainKind || ""))) {
      offer = normalizeVehicleOfferSpecs(await enrichOfferWithCertifiedPower(offer));
    }
    let calculated;''',
)
replace_once(
    europe,
    '  count: offers.length,\n  preferredCount:',
    '''  count: offers.length,
  electricCount: offers.filter((offer) => String(offer.powertrainKind || "") === "electric").length,
  hybridCount: offers.filter((offer) => ["series_hybrid", "other_hybrid"].includes(String(offer.powertrainKind || ""))).length,
  documentedPowerCount: offers.filter((offer) => String(offer.powerDataConfidence || "") === "documented").length,
  preferredCount:''',
)


direct = "scripts/catalog-live-recovery-direct-exact.mjs"
replace_once(
    direct,
    'const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");\n',
    'const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");\nconst { enrichOfferWithCertifiedPower } = await import("../apps/web/lib/catalog/power-reference.ts");\n',
)
replace_once(
    direct,
    '    offer = await fillOnlyUnambiguousSpecs(offer);\n    let calculated;',
    '''    offer = await fillOnlyUnambiguousSpecs(offer);
    if (["electric", "series_hybrid", "other_hybrid"].includes(String(offer.powertrainKind || ""))) {
      offer = normalizeVehicleOfferSpecs(await enrichOfferWithCertifiedPower(offer));
    }
    let calculated;''',
)
replace_once(
    direct,
    '  count: offers.length,\n  preferredCount:',
    '''  count: offers.length,
  electricCount: offers.filter((offer) => String(offer.powertrainKind || "") === "electric").length,
  hybridCount: offers.filter((offer) => ["series_hybrid", "other_hybrid"].includes(String(offer.powertrainKind || ""))).length,
  documentedPowerCount: offers.filter((offer) => String(offer.powerDataConfidence || "") === "documented").length,
  preferredCount:''',
)


japan = "scripts/catalog-live-recovery-japan-prestige.mjs"
replace_once(
    japan,
    'const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");\n',
    'const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");\nconst { enrichOfferWithCertifiedPower } = await import("../apps/web/lib/catalog/power-reference.ts");\n',
)
replace_once(
    japan,
    '  offer = await uniqueVariantEnrich(offer);\n  let calculated;',
    '''  offer = await uniqueVariantEnrich(offer);
  if (["electric", "series_hybrid", "other_hybrid"].includes(String(offer.powertrainKind || ""))) {
    offer = normalizeVehicleOfferSpecs(await enrichOfferWithCertifiedPower(offer));
  }
  let calculated;''',
)
replace_once(
    japan,
    '  calculatedCount: offers.filter(exactCalculation).length,\n  rejected,',
    '''  calculatedCount: offers.filter(exactCalculation).length,
  electricCount: offers.filter((offer) => String(offer.powertrainKind || "") === "electric").length,
  hybridCount: offers.filter((offer) => ["series_hybrid", "other_hybrid"].includes(String(offer.powertrainKind || ""))).length,
  documentedPowerCount: offers.filter((offer) => String(offer.powerDataConfidence || "") === "documented").length,
  rejected,''',
)


cars = "apps/web/app/(public)/cars/page.tsx"
replace_once(
    cars,
    '  if (common.fuel && String(offer.fuel || "") !== common.fuel) return false;',
    '''  if (common.fuel) {
    const kind = String(offer.powertrainKind || "");
    const canonicalFuel = kind === "electric" ? "electric" : ["series_hybrid", "other_hybrid"].includes(kind) ? "hybrid" : String(offer.fuel || "");
    if (canonicalFuel !== common.fuel) return false;
  }''',
)
