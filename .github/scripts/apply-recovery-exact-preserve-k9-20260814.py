from pathlib import Path

# 1) Central fail-closed Korea K9 engine semantic gate.
quality = Path('apps/web/lib/catalog/offer-quality.ts')
s = quality.read_text()
anchor = '''export function isCatalogKnownBodySemanticValid(offer: Pick<VehicleOffer, "market" | "make" | "model" | "trim" | "sourceTitle" | "bodyType">) {\n  if (clean(offer.market).toLowerCase() !== "korea") return true;\n  if (!/^(?:suv|crossover|offroad)$/i.test(clean(offer.bodyType))) return true;\n  const make = clean(offer.make);\n  const identity = [offer.model, offer.trim, offer.sourceTitle].map(clean).filter(Boolean).join(" ");\n  if (/^(?:genesis|제네시스)$/i.test(make) && /\\bG80\\b/i.test(identity)) return false;\n  if (/^(?:hyundai|현대)$/i.test(make) && /(?:\\bGrandeur\\b|그랜저|\\bIoniq\\s*6\\b|아이오닉\\s*6)/i.test(identity)) return false;\n  if (/^(?:kia|기아)$/i.test(make) && /(?:\\bK9\\b|\\bK900\\b|\\bQuoris\\b|퀴리스)/i.test(identity)) return false;\n  return true;\n}\n\nexport function isCatalogOfferBusinessLiquid(offer: VehicleOffer) {\n  if (!isCatalogKnownBodySemanticValid(offer)) return false;\n'''
replacement = '''export function isCatalogKnownBodySemanticValid(offer: Pick<VehicleOffer, "market" | "make" | "model" | "trim" | "sourceTitle" | "bodyType">) {\n  if (clean(offer.market).toLowerCase() !== "korea") return true;\n  if (!/^(?:suv|crossover|offroad)$/i.test(clean(offer.bodyType))) return true;\n  const make = clean(offer.make);\n  const identity = [offer.model, offer.trim, offer.sourceTitle].map(clean).filter(Boolean).join(" ");\n  if (/^(?:genesis|제네시스)$/i.test(make) && /\\bG80\\b/i.test(identity)) return false;\n  if (/^(?:hyundai|현대)$/i.test(make) && /(?:\\bGrandeur\\b|그랜저|\\bIoniq\\s*6\\b|아이오닉\\s*6)/i.test(identity)) return false;\n  if (/^(?:kia|기아)$/i.test(make) && /(?:\\bK9\\b|\\bK900\\b|\\bQuoris\\b|퀴리스)/i.test(identity)) return false;\n  return true;\n}\n\nexport function isCatalogKnownK9EngineSemanticValid(offer: VehicleOffer) {\n  if (clean(offer.market).toLowerCase() !== "korea") return true;\n  const raw = (offer.operational as any)?.raw || {};\n  const identity = [offer.make, offer.model, offer.trim, offer.sourceTitle, JSON.stringify(raw)].map(clean).filter(Boolean).join(" ");\n  if (!/(?:\\bk9\\b|k900|quoris|퀴리스)/i.test(identity)) return true;\n  const isThreeThreeGdi = /(?:\\b3[.,]3\\b[^\\n]{0,40}\\bgdi\\b|\\bgdi\\b[^\\n]{0,40}\\b3[.,]3\\b)/i.test(identity);\n  if (!isThreeThreeGdi) return true;\n  const engineCc = Number(offer.engineCc || 0);\n  if ([3000, 3300].includes(engineCc)) return false;\n  const exact3342Evidence = /(?:\\b3342\\b|\\b3,342\\b|\\b3\\.342\\b)/i.test(identity);\n  if (exact3342Evidence && engineCc !== 3342) return false;\n  return true;\n}\n\nexport function isCatalogOfferBusinessLiquid(offer: VehicleOffer) {\n  if (!isCatalogKnownBodySemanticValid(offer) || !isCatalogKnownK9EngineSemanticValid(offer)) return false;\n'''
if s.count(anchor) != 1:
    raise SystemExit(f'offer-quality anchor count={s.count(anchor)}')
s = s.replace(anchor, replacement, 1)
quality.write_text(s)

# 2) Recovery publisher opt-in exact untouched-market preservation.
publisher = Path('scripts/catalog-live-recovery-publish-batch.mjs')
p = publisher.read_text()
p = p.replace('import fs from "node:fs/promises";\nimport path from "node:path";\n', 'import crypto from "node:crypto";\nimport fs from "node:fs/promises";\nimport path from "node:path";\n', 1)
p = p.replace('const { persistCatalogOffers, readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");', 'const { persistCatalogOffers, readMarketOffers, readAllOffersForMaintenance } = await import("../apps/web/lib/catalog/storage.ts");', 1)
p = p.replace('const { credibleCatalogImages, isCatalogOfferBusinessLiquid, hasCredibleOfferContent, catalogMinYearForMarket, isCatalogYearAllowed } = await import("../apps/web/lib/catalog/offer-quality.ts");', 'const { credibleCatalogImages, isCatalogOfferBusinessLiquid, hasCredibleOfferContent, catalogMinYearForMarket, isCatalogYearAllowed, isCatalogMarketSourceAllowed } = await import("../apps/web/lib/catalog/offer-quality.ts");', 1)
old_env = 'const dryRun = /^(1|true|yes)$/i.test(String(process.env.RECOVERY_BATCH_DRY_RUN || ""));\n'
new_env = old_env + 'const preserveUntouchedExact = /^(1|true|yes)$/i.test(String(process.env.RECOVERY_BATCH_PRESERVE_UNTOUCHED_EXACT || ""));\n'
if p.count(old_env) != 1:
    raise SystemExit('publisher env anchor missing')
p = p.replace(old_env, new_env, 1)
old_key = '''function makeKey(offer) {\n  return String(offer?.make || "").trim().toLocaleLowerCase("en-US").replace(/\\s+/g, " ");\n}\n'''
new_key = old_key + '''function hashRows(rows) {\n  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");\n}\n'''
if p.count(old_key) != 1:
    raise SystemExit('publisher makeKey anchor missing')
p = p.replace(old_key, new_key, 1)
old_preserve = '''const combined = [];\nfor (const marketRows of selectedByMarket.values()) combined.push(...marketRows);\nconst preservedByMarket = {};\nfor (const other of PUBLIC_CATALOG_MARKETS) {\n  if (markets.includes(other)) continue;\n  let rows = [];\n  try { rows = await readMarketOffers(other); } catch { rows = [];\n  }\n  const preserved = rows\n    .filter((offer) => ["active", "stale"].includes(String(offer?.status || "")))\n    .map((offer) => normalizeVisible(offer))\n    .filter((offer) => offer.id && offer.make && offer.model && isCatalogYearAllowed(offer.year, other) && offer.images.length > 0 && withinRetention(offer) && canonicalPublic(offer) && isCatalogOfferBusinessLiquid(offer))\n    .slice(0, CATALOG_MAX_PUBLIC_OFFERS_PER_MARKET || 100_000);\n  preservedByMarket[other] = preserved.length;\n  combined.push(...preserved);\n}\n'''
new_preserve = '''const combined = [];\nfor (const marketRows of selectedByMarket.values()) combined.push(...marketRows);\nconst preservedByMarket = {};\nconst preservedInternalByMarket = {};\nconst preservedPublicHashByMarket = {};\nconst maintenanceOffers = preserveUntouchedExact ? await readAllOffersForMaintenance() : [];\nif (preserveUntouchedExact && !Array.isArray(maintenanceOffers)) throw new Error("recovery_batch_maintenance_state_invalid");\nfor (const other of PUBLIC_CATALOG_MARKETS) {\n  if (markets.includes(other)) continue;\n  let rows = [];\n  try { rows = await readMarketOffers(other); } catch { rows = []; }\n  if (preserveUntouchedExact) {\n    const invalidPublic = rows.filter((offer) => !offer?.id || !offer?.make || !offer?.model || !isCatalogYearAllowed(offer?.year, other) || !isCatalogMarketSourceAllowed(offer) || !Array.isArray(offer?.images) || offer.images.length === 0);\n    if (invalidPublic.length) throw new Error(`recovery_batch_preserved_public_gate_failed:${other}:${invalidPublic.length}`);\n    const internalRows = maintenanceOffers.filter((offer) => String(offer?.market || "") === other);\n    if (rows.length > 0 && internalRows.length === 0) throw new Error(`recovery_batch_preserved_internal_missing:${other}`);\n    const invalidInternal = internalRows.filter((offer) => !offer?.id || !isCatalogYearAllowed(offer?.year, other) || !isCatalogMarketSourceAllowed(offer));\n    if (invalidInternal.length) throw new Error(`recovery_batch_preserved_internal_gate_failed:${other}:${invalidInternal.length}`);\n    preservedByMarket[other] = rows.length;\n    preservedInternalByMarket[other] = internalRows.length;\n    preservedPublicHashByMarket[other] = hashRows(rows);\n    combined.push(...internalRows);\n    continue;\n  }\n  const preserved = rows\n    .filter((offer) => ["active", "stale"].includes(String(offer?.status || "")))\n    .map((offer) => normalizeVisible(offer))\n    .filter((offer) => offer.id && offer.make && offer.model && isCatalogYearAllowed(offer.year, other) && offer.images.length > 0 && withinRetention(offer) && canonicalPublic(offer) && isCatalogOfferBusinessLiquid(offer))\n    .slice(0, CATALOG_MAX_PUBLIC_OFFERS_PER_MARKET || 100_000);\n  preservedByMarket[other] = preserved.length;\n  combined.push(...preserved);\n}\n'''
if p.count(old_preserve) != 1:
    raise SystemExit(f'publisher preserve anchor count={p.count(old_preserve)}')
p = p.replace(old_preserve, new_preserve, 1)
# Add exact preservation report fields in both dry-run and publish reports.
p = p.replace('''    minImagesPerOffer,\n    byMarket: marketReports,\n    preservedByMarket,\n  };''', '''    minImagesPerOffer,\n    preserveUntouchedExact,\n    byMarket: marketReports,\n    preservedByMarket,\n    preservedInternalByMarket,\n    preservedPublicHashByMarket,\n  };''', 1)
old_unique = '''const unique = new Map();\nfor (const offer of combined) if (offer?.id && !unique.has(offer.id)) unique.set(offer.id, offer);\nprocess.env.CATALOG_GROW_ONLY_MARKETS = "";\nconst manifest = await persistCatalogOffers([...unique.values()]);\n'''
new_unique = '''const unique = new Map();\nfor (const offer of combined) if (offer?.id && !unique.has(offer.id)) unique.set(offer.id, offer);\nif (preserveUntouchedExact && unique.size !== combined.length) throw new Error(`recovery_batch_duplicate_id_in_full_state:${combined.length - unique.size}`);\nprocess.env.CATALOG_GROW_ONLY_MARKETS = "";\nconst manifest = await persistCatalogOffers([...unique.values()]);\n'''
if p.count(old_unique) != 1:
    raise SystemExit('publisher unique anchor missing')
p = p.replace(old_unique, new_unique, 1)
verify_anchor = '''for (const market of markets) {\n  const rows = selectedByMarket.get(market) || [];\n  const manifestCount = Number(manifest?.markets?.[market]?.count || 0);\n  if (manifestCount !== rows.length) {\n    const debugReport = {\n      version: 5,\n      mode: "live_markets_publishable_cumulative_batch_publish",\n      markets,\n      published: false,\n      generationId: manifest?.generationId || null,\n      failure: `recovery_batch_manifest_mismatch:${market}:${manifestCount}:${rows.length}`,\n      selectedCounts: Object.fromEntries(markets.map((item) => [item, (selectedByMarket.get(item) || []).length])),\n      manifestCounts: Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((item) => [item, Number(manifest?.markets?.[item]?.count || 0)])),\n      preservedByMarket,\n    };\n    await fs.writeFile(output, JSON.stringify(debugReport, null, 2));\n    throw new Error(debugReport.failure);\n  }\n}\n\nconst report = {\n'''
verify_replacement = verify_anchor.replace('\n\nconst report = {\n', '''\n\nif (preserveUntouchedExact) {\n  for (const other of PUBLIC_CATALOG_MARKETS) {\n    if (markets.includes(other)) continue;\n    const manifestCount = Number(manifest?.markets?.[other]?.count || 0);\n    if (manifestCount !== Number(preservedByMarket[other] || 0)) throw new Error(`recovery_batch_preserved_manifest_mismatch:${other}:${manifestCount}:${preservedByMarket[other] || 0}`);\n    const afterRows = await readMarketOffers(other);\n    if (afterRows.length !== Number(preservedByMarket[other] || 0)) throw new Error(`recovery_batch_preserved_count_mismatch:${other}:${afterRows.length}:${preservedByMarket[other] || 0}`);\n    const afterHash = hashRows(afterRows);\n    if (afterHash !== preservedPublicHashByMarket[other]) throw new Error(`recovery_batch_preserved_hash_mismatch:${other}:${afterHash}:${preservedPublicHashByMarket[other]}`);\n  }\n}\n\nconst report = {\n''')
if p.count(verify_anchor) != 1:
    raise SystemExit(f'publisher verify anchor count={p.count(verify_anchor)}')
p = p.replace(verify_anchor, verify_replacement, 1)
p = p.replace('''  minImagesPerOffer,\n  byMarket: marketReports,\n  preservedByMarket,\n  manifestCounts:''', '''  minImagesPerOffer,\n  preserveUntouchedExact,\n  byMarket: marketReports,\n  preservedByMarket,\n  preservedInternalByMarket,\n  preservedPublicHashByMarket,\n  manifestCounts:''', 1)
publisher.write_text(p)

# 3) Regression tests for K9 semantics.
test_file = Path('tests/catalog-image-quality.test.ts')
t = test_file.read_text()
append = '''\n\ntest("rejects rounded Korea K9 3.3 GDI displacement and keeps exact 3342cc evidence", () => {\n  const k9 = {\n    ...rawOffer,\n    make: "Kia",\n    model: "K9(II) 3.3 GDI AWD",\n    trim: "K9(II) 3.3 GDI AWD",\n    sourceTitle: "Kia K9 3.3 GDI AWD",\n    engineCc: 3300,\n    operational: { raw: {} },\n  };\n  assert.equal(isCatalogOfferBusinessLiquid(k9 as any), false);\n  assert.equal(isCatalogOfferBusinessLiquid({ ...k9, engineCc: 3000 } as any), false);\n  assert.equal(isCatalogOfferBusinessLiquid({ ...k9, engineCc: 3342 } as any), true);\n  assert.equal(isCatalogOfferBusinessLiquid({ ...k9, engineCc: 3300, sourceTitle: "Kia K9 3.3 GDI 3342 cc" } as any), false);\n});\n'''
if 'rejects rounded Korea K9 3.3 GDI displacement' in t:
    raise SystemExit('K9 test already present')
test_file.write_text(t.rstrip() + append)

# 4) Static safety contract for recovery publisher exact preservation mode.
hardening = Path('tests/catalog-production-hardening.test.ts')
h = hardening.read_text()
var_anchor = 'const publisher = fs.readFileSync(new URL("../scripts/catalog-publish-source-scale.mjs", import.meta.url), "utf8");\n'
var_new = var_anchor + 'const recoveryPublisher = fs.readFileSync(new URL("../scripts/catalog-live-recovery-publish-batch.mjs", import.meta.url), "utf8");\n'
if h.count(var_anchor) != 1:
    raise SystemExit('hardening publisher var anchor missing')
h = h.replace(var_anchor, var_new, 1)
test_anchor = '''test("daily cleanup keeps a three-day grace while emergency cleanup preserves the live generation", () => {\n'''
safety_test = '''test("recovery publisher has opt-in exact preservation for untouched full maintenance state", () => {\n  assert.match(recoveryPublisher, /readAllOffersForMaintenance/);\n  assert.match(recoveryPublisher, /RECOVERY_BATCH_PRESERVE_UNTOUCHED_EXACT/);\n  assert.match(recoveryPublisher, /preservedInternalByMarket/);\n  assert.match(recoveryPublisher, /preservedPublicHashByMarket/);\n  assert.match(recoveryPublisher, /recovery_batch_preserved_internal_gate_failed/);\n  assert.match(recoveryPublisher, /recovery_batch_preserved_manifest_mismatch/);\n  assert.match(recoveryPublisher, /recovery_batch_preserved_hash_mismatch/);\n});\n\n'''
if h.count(test_anchor) != 1:
    raise SystemExit('hardening test anchor missing')
h = h.replace(test_anchor, safety_test + test_anchor, 1)
hardening.write_text(h)

print('applied recovery exact-preserve + K9 safety patch')
