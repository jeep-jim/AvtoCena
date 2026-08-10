from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    s = p.read_text()
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'{label}: expected 1 anchor, got {n}')
    p.write_text(s.replace(old, new, 1))

pk = 'apps/web/lib/catalog/power-knowledge.ts'
replace_once(
    pk,
    '  trimContains?: string[];\n  yearFrom?: number;\n',
    '  trimContains?: string[];\n  chassisCodes?: string[];\n  yearFrom?: number;\n',
    'power knowledge chassis type',
)
replace_once(
    pk,
    'function modelMatches(reference: VehiclePowerKnowledge, offer: Partial<VehicleOffer>) {\n  const offerModel = compact(offer.model);\n  const candidates = [reference.model, ...(reference.aliases || [])].map(compact).filter(Boolean);\n  return Boolean(offerModel && candidates.some((candidate) => candidate === offerModel));\n}\n\nfunction score(reference: VehiclePowerKnowledge, offer: Partial<VehicleOffer>) {',
    '''function modelMatches(reference: VehiclePowerKnowledge, offer: Partial<VehicleOffer>) {\n  const offerModel = compact(offer.model);\n  const candidates = [reference.model, ...(reference.aliases || [])].map(compact).filter(Boolean);\n  return Boolean(offerModel && candidates.some((candidate) => candidate === offerModel));\n}\n\nfunction offerChassis(offer: Partial<VehicleOffer>) {\n  const raw: any = offer.operational?.raw || {};\n  const fields: any = raw?.fields || {};\n  return compact(fields.Chassis || fields.CHASSIS || fields.chassis || raw.chassis || raw.chassisCode || raw.modelCode || raw.model_code);\n}\n\nfunction score(reference: VehiclePowerKnowledge, offer: Partial<VehicleOffer>) {''',
    'offer chassis helper',
)
replace_once(
    pk,
    '  let result = 100;\n  if (reference.yearFrom || reference.yearTo) result += 10;\n\n  const engineCc = positive(offer.engineCc, 10_000);\n',
    '''  let result = 100;\n  if (reference.yearFrom || reference.yearTo) result += 10;\n\n  if (reference.chassisCodes?.length) {\n    const chassis = offerChassis(offer);\n    const allowed = reference.chassisCodes.map(compact).filter(Boolean);\n    if (!chassis || !allowed.includes(chassis)) return -1;\n    result += 50;\n  }\n\n  const engineCc = positive(offer.engineCc, 10_000);\n''',
    'chassis scoring',
)

jp = 'scripts/catalog-live-recovery-japan-prestige.mjs'
replace_once(
    jp,
    'const { enrichOfferWithCertifiedPower } = await import("../apps/web/lib/catalog/power-reference.ts");\nconst { findVehicleModel, readVehicleKnowledgeVariants } = await import("../apps/web/lib/catalog/vehicle-knowledge.ts");\n',
    'const { enrichOfferWithCertifiedPower } = await import("../apps/web/lib/catalog/power-reference.ts");\nconst { findVehiclePowerKnowledge } = await import("../apps/web/lib/catalog/power-knowledge.ts");\nconst { findVehicleModel, readVehicleKnowledgeVariants } = await import("../apps/web/lib/catalog/vehicle-knowledge.ts");\n',
    'Japan import',
)
replace_once(
    jp,
    '  const baseVariants = allVariants.filter((variant) => {\n    if (variant.active === false || variant.modelId !== match.model.id) return false;\n',
    '  const baseVariants = allVariants.filter((variant) => {\n    if (variant.active === false || variant.modelId !== match.model.id) return false;\n    if (!["manufacturer", "official_registry"].includes(String(variant.sourceType || ""))) return false;\n',
    'Japan official variant restriction',
)
replace_once(
    jp,
    '}\nasync function pool(rows, limit, worker) {',
    '''}\nasync function officialIcePowerEnrich(offer) {\n  const kind = String(offer?.powertrainKind || "");\n  if (["electric", "series_hybrid", "other_hybrid"].includes(kind)) return offer;\n  const engineCc = Number(offer?.engineCc || 0);\n  if (!(engineCc > 0) || Number(offer?.powerHp || 0) > 0) return offer;\n  const reference = await findVehiclePowerKnowledge(offer).catch(() => null);\n  if (!reference || !["manufacturer", "registry"].includes(String(reference.confidence || ""))) return offer;\n  if (String(reference.powertrainKind || "combustion") !== "combustion") return offer;\n  const referenceEngineCc = Number(reference.engineCc || 0);\n  if (!(referenceEngineCc > 0)) return offer;\n  const tolerance = Math.max(20, Number(reference.engineCcTolerance || 80));\n  if (Math.abs(referenceEngineCc - engineCc) > tolerance) return offer;\n  const powerHp = Number(reference.powerHp || 0);\n  if (!(powerHp > 0)) return offer;\n  return normalizeVehicleOfferSpecs({\n    ...offer,\n    powerHp,\n    powerKw: Number(reference.powerKw || 0) > 0 ? Number(reference.powerKw) : Math.round((powerHp / 1.359621617) * 10) / 10,\n    powerDataConfidence: "documented",\n    powerDataSource: reference.sourceUrl || `power-knowledge:${reference.id}`,\n    operational: {\n      ...(offer.operational || {}),\n      raw: {\n        ...(offer.operational?.raw || {}),\n        recoveryOfficialIcePowerReferenceId: reference.id,\n        recoveryOfficialIcePowerConfidence: reference.confidence,\n      },\n    },\n  });\n}\nasync function pool(rows, limit, worker) {''',
    'Japan official ICE helper',
)
replace_once(
    jp,
    '  offer = normalizeVehicleOfferSpecs(await enrichOfferWithCertifiedPower(offer));\n  if (!(Number(offer.engineCc || 0) > 0) && String(offer.powertrainKind || "") !== "electric") { reject("engine_cc"); return null; }\n',
    '  offer = normalizeVehicleOfferSpecs(await enrichOfferWithCertifiedPower(offer));\n  offer = await officialIcePowerEnrich(offer);\n  if (!(Number(offer.engineCc || 0) > 0) && String(offer.powertrainKind || "") !== "electric") { reject("engine_cc"); return null; }\n',
    'Japan enrichment call',
)
replace_once(
    jp,
    '  documentedPowerCount: offers.filter((offer) => String(offer.powerDataConfidence || "") === "documented").length,\n  rejected,\n',
    '  documentedPowerCount: offers.filter((offer) => String(offer.powerDataConfidence || "") === "documented").length,\n  officialIcePowerCount: offers.filter((offer) => Boolean(offer?.operational?.raw?.recoveryOfficialIcePowerReferenceId)).length,\n  rejected,\n',
    'Japan report',
)
