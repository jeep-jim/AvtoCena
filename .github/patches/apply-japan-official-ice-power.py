from pathlib import Path

p = Path('scripts/catalog-live-recovery-japan-prestige.mjs')
s = p.read_text()

def replace_once(old, new, label):
    global s
    if s.count(old) != 1:
        raise SystemExit(f'{label} anchor mismatch: {s.count(old)}')
    s = s.replace(old, new, 1)

replace_once(
    'const { enrichOfferWithCertifiedPower } = await import("../apps/web/lib/catalog/power-reference.ts");\nconst { findVehicleModel, readVehicleKnowledgeVariants } = await import("../apps/web/lib/catalog/vehicle-knowledge.ts");\n',
    'const { enrichOfferWithCertifiedPower } = await import("../apps/web/lib/catalog/power-reference.ts");\nconst { findVehiclePowerKnowledge } = await import("../apps/web/lib/catalog/power-knowledge.ts");\nconst { findVehicleModel, readVehicleKnowledgeVariants } = await import("../apps/web/lib/catalog/vehicle-knowledge.ts");\n',
    'import',
)
replace_once(
    '  const baseVariants = allVariants.filter((variant) => {\n    if (variant.active === false || variant.modelId !== match.model.id) return false;\n',
    '  const baseVariants = allVariants.filter((variant) => {\n    if (variant.active === false || variant.modelId !== match.model.id) return false;\n    if (!["manufacturer", "official_registry"].includes(String(variant.sourceType || ""))) return false;\n',
    'variant source type',
)
replace_once(
    '}\nasync function pool(rows, limit, worker) {',
    '''}\nasync function officialIcePowerEnrich(offer) {\n  const kind = String(offer?.powertrainKind || "");\n  if (["electric", "series_hybrid", "other_hybrid"].includes(kind)) return offer;\n  const engineCc = Number(offer?.engineCc || 0);\n  if (!(engineCc > 0) || Number(offer?.powerHp || 0) > 0) return offer;\n  const reference = await findVehiclePowerKnowledge(offer).catch(() => null);\n  if (!reference || !["manufacturer", "registry"].includes(String(reference.confidence || ""))) return offer;\n  if (["electric", "series_hybrid", "other_hybrid"].includes(String(reference.powertrainKind || ""))) return offer;\n  const referenceEngineCc = Number(reference.engineCc || 0);\n  if (!(referenceEngineCc > 0)) return offer;\n  const tolerance = Math.max(20, Number(reference.engineCcTolerance || 80));\n  if (Math.abs(referenceEngineCc - engineCc) > tolerance) return offer;\n  const powerHp = Number(reference.powerHp || 0);\n  if (!(powerHp > 0)) return offer;\n  return normalizeVehicleOfferSpecs({\n    ...offer,\n    powerHp,\n    powerKw: Number(reference.powerKw || 0) > 0 ? Number(reference.powerKw) : Math.round((powerHp / 1.359621617) * 10) / 10,\n    powerDataConfidence: "documented",\n    powerDataSource: reference.sourceUrl || `power-knowledge:${reference.id}`,\n    operational: {\n      ...(offer.operational || {}),\n      raw: {\n        ...(offer.operational?.raw || {}),\n        recoveryOfficialIcePowerReferenceId: reference.id,\n        recoveryOfficialIcePowerConfidence: reference.confidence,\n      },\n    },\n  });\n}\nasync function pool(rows, limit, worker) {''',
    'helper',
)
replace_once(
    '  offer = normalizeVehicleOfferSpecs(await enrichOfferWithCertifiedPower(offer));\n  if (!(Number(offer.engineCc || 0) > 0) && String(offer.powertrainKind || "") !== "electric") { reject("engine_cc"); return null; }\n',
    '  offer = normalizeVehicleOfferSpecs(await enrichOfferWithCertifiedPower(offer));\n  offer = await officialIcePowerEnrich(offer);\n  if (!(Number(offer.engineCc || 0) > 0) && String(offer.powertrainKind || "") !== "electric") { reject("engine_cc"); return null; }\n',
    'enrich',
)
replace_once(
    '  documentedPowerCount: offers.filter((offer) => String(offer.powerDataConfidence || "") === "documented").length,\n  rejected,\n',
    '  documentedPowerCount: offers.filter((offer) => String(offer.powerDataConfidence || "") === "documented").length,\n  officialIcePowerCount: offers.filter((offer) => Boolean(offer?.operational?.raw?.recoveryOfficialIcePowerReferenceId)).length,\n  rejected,\n',
    'report',
)
p.write_text(s)
