from pathlib import Path

source = Path('apps/web/lib/catalog/autopapa-georgia-source.ts')
text = source.read_text()
old = r'''export function autoPapaDetailPriceUsd(markup: string) {
  const h1Index = markup.search(/<h1\b/i);
  if (h1Index < 0) return undefined;
  const tail = markup.slice(h1Index, Math.min(markup.length, h1Index + 6_000));
  const helperIndex = tail.search(/STARTING\s+PRICE\s+(?:AT|IN)\b/i);
  const primaryHeader = plain(tail.slice(0, helperIndex >= 0 ? helperIndex : Math.min(tail.length, 2_500)));
  const tokens = [
    ...primaryHeader.matchAll(/(?:USD|US\$|\$)\s*([0-9][0-9\s,.'’]{1,18})/gi),
    ...primaryHeader.matchAll(/([0-9][0-9\s,.'’]{1,18})\s*(?:USD|US\$|\$)/gi),
  ];
  for (const match of tokens) {
    const value = integer(match[1]);
    if (value && value >= 500 && value <= 5_000_000) return value;
  }
  return undefined;
}
'''
new = r'''function autoPapaSinglePriceToken(value: string) {
  const values = [
    ...value.matchAll(/(?:USD|US\$|\$)\s*([0-9][0-9\s,.'’]{1,18})/gi),
    ...value.matchAll(/([0-9][0-9\s,.'’]{1,18})\s*(?:USD|US\$|\$)/gi),
  ]
    .map((match) => integer(match[1]))
    .filter((price): price is number => Boolean(price && price >= 500 && price <= 5_000_000));
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0] : undefined;
}

export function autoPapaSellerDeclaredPriceUsd(markup: string) {
  const text = plain(markup);
  const start = text.search(/\bMore\s+details\b/i);
  if (start < 0) return undefined;
  const tail = text.slice(start, Math.min(text.length, start + 2_500));
  const end = tail.search(/\b(?:let\s+me\s+know\s+when\s+a\s+car\s+like\s+this\s+is\s+found|add\s+to\s+favorites|send\s+to\s+friend|Report\s+ad|views|created\s+at)\b/i);
  const details = tail.slice(0, end > 0 ? end : tail.length);
  const match = details.match(/\b(?:Cena|Цена)\s*:\s*([0-9][0-9\s,.'’]{1,18})\s*(?:USD|US\$|\$)/i);
  const value = integer(match?.[1]);
  return value && value >= 500 && value <= 5_000_000 ? value : undefined;
}

export function autoPapaStructuredPrimaryPriceUsd(markup: string, identity?: Pick<VehicleOffer, "make" | "model">) {
  const text = plain(markup);
  const helperIndex = text.search(/\bSTARTING\s+PRICE\s+(?:AT|IN)\b/i);
  const factsIndex = text.search(/\bBody\s+Type\s*:/i);
  const primaryEnd = helperIndex >= 0 ? helperIndex : factsIndex >= 0 ? factsIndex : Math.min(text.length, 6_000);
  const primary = text.slice(0, primaryEnd);
  const title = [identity?.make, identity?.model].map((value) => String(value || "").trim()).filter(Boolean).join(" ");
  if (title) {
    const escaped = title.split(/\s+/).map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
    const matches = [...primary.matchAll(new RegExp(escaped, "ig"))];
    for (let index = matches.length - 1; index >= 0; index--) {
      const match = matches[index];
      const start = Number(match.index || 0) + match[0].length;
      const price = autoPapaSinglePriceToken(primary.slice(start, Math.min(primary.length, start + 320)));
      if (price) return price;
    }
  }
  return autoPapaSinglePriceToken(primary.slice(Math.max(0, primary.length - 900)));
}

/**
 * AutoPapa may display a teaser/structured amount beside the title while the
 * seller explicitly writes the actual asking price in this exact vehicle's
 * `More details` block as `Cena: ... $`. The seller-declared price is therefore
 * authoritative when present; only otherwise may the primary structured amount
 * be used. Customs helper boxes and recommendation cards are outside both scopes.
 */
export function autoPapaDetailPriceUsd(markup: string, identity?: Pick<VehicleOffer, "make" | "model">) {
  return autoPapaSellerDeclaredPriceUsd(markup) || autoPapaStructuredPrimaryPriceUsd(markup, identity);
}
'''
if old not in text:
    raise SystemExit('old AutoPapa price parser not found')
text = text.replace(old, new, 1)
old = '''  const priceUsd = autoPapaDetailPriceUsd(markup);\n  const powerHp = String(offer.powertrainKind || "") === "combustion" ? autoPapaDetailPowerHp(markup) : undefined;\n  return { sourceOfferId, originals, powerHp, ...(priceUsd ? { priceUsd } : {}) };\n'''
new = '''  const sellerDeclaredPriceUsd = autoPapaSellerDeclaredPriceUsd(markup);\n  const structuredPriceUsd = autoPapaStructuredPrimaryPriceUsd(markup, offer);\n  const priceUsd = sellerDeclaredPriceUsd || structuredPriceUsd;\n  const priceAuthority = sellerDeclaredPriceUsd ? "seller_declared_cena" : structuredPriceUsd ? "structured_primary" : undefined;\n  const powerHp = String(offer.powertrainKind || "") === "combustion" ? autoPapaDetailPowerHp(markup) : undefined;\n  return { sourceOfferId, originals, powerHp, priceAuthority, sellerDeclaredPriceUsd, structuredPriceUsd, ...(priceUsd ? { priceUsd } : {}) };\n'''
if old not in text:
    raise SystemExit('exact detail facts block missing')
text = text.replace(old, new, 1)
old = '''      autoPapaDetailPriceVerified: Boolean(facts.priceUsd),\n      ...(facts.priceUsd ? { autoPapaDetailPriceUsd: facts.priceUsd } : {}),\n      ...(facts.powerHp ? { autoPapaDetailPowerHp: facts.powerHp } : {}),\n'''
new = '''      autoPapaDetailPriceVerified: Boolean(facts.priceUsd),\n      ...(facts.priceUsd ? { autoPapaDetailPriceUsd: facts.priceUsd } : {}),\n      ...(facts.priceAuthority ? { autoPapaDetailPriceAuthority: facts.priceAuthority } : {}),\n      ...(facts.sellerDeclaredPriceUsd ? { autoPapaSellerDeclaredPriceUsd: facts.sellerDeclaredPriceUsd } : {}),\n      ...(facts.structuredPriceUsd ? { autoPapaStructuredPriceUsd: facts.structuredPriceUsd } : {}),\n      ...(facts.powerHp ? { autoPapaDetailPowerHp: facts.powerHp } : {}),\n'''
if old not in text:
    raise SystemExit('exact detail raw block missing')
text = text.replace(old, new, 1)
source.write_text(text)

recovery = Path('apps/web/lib/catalog/georgia-yandex-recovery.ts')
text = recovery.read_text()
old = '''        autoPapaDetailPriceVerified: true,\n        autoPapaDetailPriceUsd: facts.priceUsd,\n        autoPapaListPriceUsd: offer.sourcePrice || null,\n        autoPapaDetailPowerHp: sourceExactPowerHp || null,\n'''
new = '''        autoPapaDetailPriceVerified: true,\n        autoPapaDetailPriceUsd: facts.priceUsd,\n        autoPapaDetailPriceAuthority: facts.priceAuthority || null,\n        autoPapaSellerDeclaredPriceUsd: facts.sellerDeclaredPriceUsd || null,\n        autoPapaStructuredPriceUsd: facts.structuredPriceUsd || null,\n        autoPapaListPriceUsd: offer.sourcePrice || null,\n        autoPapaDetailPowerHp: sourceExactPowerHp || null,\n'''
if old not in text:
    raise SystemExit('Georgia recovery AutoPapa raw block missing')
text = text.replace(old, new, 1)
recovery.write_text(text)

rebuild = Path('scripts/catalog-rebuild-source-shard.mjs')
text = rebuild.read_text()
anchor = 'const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");\n'
if 'needsSourceDetailFactRefresh' not in text:
    if anchor not in text:
        raise SystemExit('rebuild import anchor missing')
    text = text.replace(anchor, anchor + 'const { needsSourceDetailFactRefresh } = await import("../apps/web/lib/catalog/importer-impl.ts");\n', 1)

anchor = 'function currentTime(offer) { return Date.parse(String(offer?.operational?.sourcePublishedAt || offer?.updatedAt || offer?.firstSeenAt || "")) || 0; }\n'
if 'function hasVerifiedAutoPapaPrice' not in text:
    if anchor not in text:
        raise SystemExit('rebuild helper anchor missing')
    text = text.replace(anchor, anchor + '''function hasVerifiedAutoPapaPrice(offer) {\n  if (String(offer?.sourceId || "") !== "autopapa_georgia_open") return true;\n  const raw = offer?.operational?.raw || {};\n  const exact = Number(raw?.autoPapaDetailPriceUsd || 0);\n  return raw?.autoPapaDetailPriceVerified === true\n    && exact > 0\n    && String(raw?.autoPapaDetailPriceAuthority || "").length > 0\n    && Math.round(Number(offer?.sourcePrice || 0)) === Math.round(exact);\n}\n''', 1)

old = '      if (offer.images.length >= minimumImages && isCrediblePublicOffer(offer)) {\n        bucket.set(offer.id, offer);\n'
new = '      if (offer.images.length >= minimumImages && isCrediblePublicOffer(offer) && hasVerifiedAutoPapaPrice(offer)) {\n        bucket.set(offer.id, offer);\n'
if old in text:
    text = text.replace(old, new, 1)
elif 'isCrediblePublicOffer(offer) && hasVerifiedAutoPapaPrice(offer)' not in text:
    raise SystemExit('candidate retention gate missing')

old = '  if (offer.images.length >= minimumImages && isCrediblePublicOffer(offer)) bucket.set(offer.id, offer);\n'
new = '  if (offer.images.length >= minimumImages && isCrediblePublicOffer(offer) && hasVerifiedAutoPapaPrice(offer)) bucket.set(offer.id, offer);\n'
if old in text:
    text = text.replace(old, new, 1)
elif 'isCrediblePublicOffer(offer) && hasVerifiedAutoPapaPrice(offer)) bucket.set' not in text:
    raise SystemExit('public retention gate missing')

old = '  const detailNeeded = mandatoryPhotoMissing || criticalSpecsMissing || priorityGalleryMissing;\n'
new = '  const detailFactsNeeded = needsSourceDetailFactRefresh(offer) && !hasVerifiedAutoPapaPrice(offer);\n  const detailNeeded = mandatoryPhotoMissing || criticalSpecsMissing || priorityGalleryMissing || detailFactsNeeded;\n'
if old in text:
    text = text.replace(old, new, 1)
elif 'const detailFactsNeeded = needsSourceDetailFactRefresh(offer) && !hasVerifiedAutoPapaPrice(offer);' not in text:
    raise SystemExit('detailNeeded anchor missing')

old = '  if (gallery.length < minimumImages) { reject(detailDeferredForOffer ? "images_detail_budget" : "images"); return null; }\n'
new = '  if (sourceId === "autopapa_georgia_open" && !hasVerifiedAutoPapaPrice(offer)) { reject("source_detail_price"); return null; }\n' + old
if old in text:
    text = text.replace(old, new, 1)
elif 'reject("source_detail_price")' not in text:
    raise SystemExit('post-detail price gate missing')
rebuild.write_text(text)

validator = Path('scripts/catalog-validate-source-scale.mjs')
text = validator.read_text()
old = '''  const requiredProductiveSourceIds = [...requiredSourceIds].filter((sourceId) => Number(candidatesBySource.get(sourceId) || 0) > 0);\n  const requiredUnproductiveSourceIds = [...requiredSourceIds].filter((sourceId) => !requiredProductiveSourceIds.includes(sourceId));\n'''
new = '''  const requiredProductiveSourceIds = [...requiredSourceIds].filter((sourceId) => Number(candidatesBySource.get(sourceId) || 0) > 0);\n  const requiredUnproductiveSourceIds = [...requiredSourceIds].filter((sourceId) => !requiredProductiveSourceIds.includes(sourceId));\n  const requiredFreshProductiveSourceIds = [...requiredSourceIds].filter((sourceId) => Number(freshBySource.get(sourceId) || 0) > 0);\n  const requiredFreshUnproductiveSourceIds = [...requiredSourceIds].filter((sourceId) => !requiredFreshProductiveSourceIds.includes(sourceId));\n'''
if old not in text:
    raise SystemExit('validator required productiveness block missing')
text = text.replace(old, new, 1)
old = '''    requiredProductiveSourceIds: requiredProductiveSourceIds.sort(),\n    requiredUnproductiveSourceIds: requiredUnproductiveSourceIds.sort(),\n'''
new = '''    requiredProductiveSourceIds: requiredProductiveSourceIds.sort(),\n    requiredUnproductiveSourceIds: requiredUnproductiveSourceIds.sort(),\n    requiredFreshProductiveSourceIds: requiredFreshProductiveSourceIds.sort(),\n    requiredFreshUnproductiveSourceIds: requiredFreshUnproductiveSourceIds.sort(),\n'''
if old not in text:
    raise SystemExit('validator report source fields missing')
text = text.replace(old, new, 1)
old = '  if (row.requiredUnproductiveSourceIds.length) warnings.push(`${market}:required_sources_unproductive:${row.requiredUnproductiveSourceIds.join(",")}`);\n'
new = old + '  if (row.requiredFreshUnproductiveSourceIds.length) warnings.push(`${market}:required_sources_without_fresh_verified_rows:${row.requiredFreshUnproductiveSourceIds.join(",")}`);\n'
if old not in text:
    raise SystemExit('validator warning anchor missing')
text = text.replace(old, new, 1)
old = '''    || !row.requiredSourcesAttempted\n    || !row.requiredSourceContinuity\n    || !row.sourceTargetReached;\n'''
new = '''    || !row.requiredSourcesAttempted\n    || !row.requiredSourceContinuity\n    || (market === "georgia" && row.requiredFreshUnproductiveSourceIds.length > 0)\n    || !row.sourceTargetReached;\n'''
if old not in text:
    raise SystemExit('validator blocking anchor missing')
text = text.replace(old, new, 1)
validator.write_text(text)

ci = Path('.github/workflows/ci.yml')
text = ci.read_text()
old = 'tests/autopapa-georgia-current-parser-20260812.test.ts tests/catalog-preliminary-power-recovery.test.ts'
new = 'tests/autopapa-georgia-current-parser-20260812.test.ts tests/catalog-autopapa-detail-refresh.test.ts tests/catalog-autopapa-v3-price-authority.test.ts tests/catalog-preliminary-power-recovery.test.ts'
if old in text:
    text = text.replace(old, new, 1)
elif 'tests/catalog-autopapa-v3-price-authority.test.ts' not in text:
    raise SystemExit('CI Georgia test anchor missing')
ci.write_text(text)

refresh_test = Path('tests/catalog-autopapa-detail-refresh.test.ts')
refresh_test.write_text('''import assert from "node:assert/strict";\nimport test from "node:test";\nimport { needsSourceDetailFactRefresh } from "../apps/web/lib/catalog/importer-impl";\nimport type { VehicleOffer } from "../apps/web/lib/catalog/types";\n\nfunction offer(overrides: Partial<VehicleOffer> = {}) {\n  return { sourceId: "autopapa_georgia_open", sourceOfferId: "932906", market: "georgia", powertrainKind: "combustion", calculationStatus: "estimated", ...overrides } as VehicleOffer;\n}\n\ntest("every AutoPapa row is eligible for exact detail fact refresh", () => {\n  assert.equal(needsSourceDetailFactRefresh(offer({ powerHp: 147, images: Array.from({ length: 30 }) as any })), true);\n  assert.equal(needsSourceDetailFactRefresh(offer({ powertrainKind: "electric", powerHp: 204 })), true);\n});\n\ntest("AutoPapa refresh gate cannot affect another source", () => {\n  assert.equal(needsSourceDetailFactRefresh(offer({ sourceId: "myauto_georgia_list" })), false);\n});\n''')

v3_test = Path('tests/catalog-autopapa-v3-price-authority.test.ts')
v3_test.write_text('''import assert from "node:assert/strict";\nimport fs from "node:fs";\nimport test from "node:test";\nimport { autoPapaDetailPriceUsd, autoPapaSellerDeclaredPriceUsd, autoPapaStructuredPrimaryPriceUsd } from "../apps/web/lib/catalog/autopapa-georgia-source";\n\nconst rebuild = fs.readFileSync(new URL("../scripts/catalog-rebuild-source-shard.mjs", import.meta.url), "utf8");\nconst validator = fs.readFileSync(new URL("../scripts/catalog-validate-source-scale.mjs", import.meta.url), "utf8");\n\nconst kona = `\n  <div>Home / Hyundai / Kona / Hyundai Kona, 2023 (#958003)</div>\n  <div class="vehicle-title">Hyundai Kona</div><span class="vehicle-price">$4 938</span>\n  <div>STARTING PRICE AT A REDUCTION IN GEORGIA, INCLUDING CUSTOMS CLEARANCE (BARGAINING) $6 314</div>\n  <div>STARTING PRICE IN GEORGIA INCLUDING CUSTOMS CLEARANCE $6 130</div>\n  <div>Body Type: SUV Power: Engine Vol: 2.0 l</div><div>Car description</div>\n  <div>More details VIN : KM8K22AB4PU044726 Cena : 12900 $ , 2023 god 4 mesac , probeg : 27 000 kilometer</div>\n  <div>let me know when a car like this is found add to favorites send to friend Report ad</div>\n  <aside>Top listings Hyundai Kona $12 700</aside>`;\n\ntest("seller-declared Cena is authoritative over AutoPapa teaser/header and customs helper amounts", () => {\n  assert.equal(autoPapaSellerDeclaredPriceUsd(kona), 12_900);\n  assert.equal(autoPapaStructuredPrimaryPriceUsd(kona, { make: "Hyundai", model: "Kona" } as any), 4_938);\n  assert.equal(autoPapaDetailPriceUsd(kona, { make: "Hyundai", model: "Kona" } as any), 12_900);\n});\n\ntest("AutoPapa falls back to the primary structured amount only when no seller Cena is declared", () => {\n  const withoutCena = kona.replace("Cena : 12900 $ , ", "");\n  assert.equal(autoPapaSellerDeclaredPriceUsd(withoutCena), undefined);\n  assert.equal(autoPapaDetailPriceUsd(withoutCena, { make: "Hyundai", model: "Kona" } as any), 4_938);\n});\n\ntest("customs helpers and recommendation cards cannot become sourcePrice", () => {\n  const markup = `<div>Hyundai Kona</div><div>STARTING PRICE IN GEORGIA $6 130</div><div>Body Type: SUV</div><div>Car description</div><aside>Top listings Hyundai Kona $12 700</aside>`;\n  assert.equal(autoPapaDetailPriceUsd(markup, { make: "Hyundai", model: "Kona" } as any), undefined);\n});\n\ntest("V3 drops unverified retained AutoPapa prices and requires exact-price authority", () => {\n  assert.match(rebuild, /function hasVerifiedAutoPapaPrice/);\n  assert.match(rebuild, /autoPapaDetailPriceAuthority/);\n  assert.match(rebuild, /isCrediblePublicOffer\\(offer\\) && hasVerifiedAutoPapaPrice\\(offer\\)/);\n  assert.match(rebuild, /needsSourceDetailFactRefresh\\(offer\\) && !hasVerifiedAutoPapaPrice\\(offer\\)/);\n  assert.match(rebuild, /reject\\("source_detail_price"\\)/);\n});\n\ntest("Georgia cannot publish green while a required canonical source has zero fresh verified rows", () => {\n  assert.match(validator, /requiredFreshProductiveSourceIds/);\n  assert.match(validator, /requiredFreshUnproductiveSourceIds/);\n  assert.match(validator, /market === "georgia" && row\\.requiredFreshUnproductiveSourceIds\\.length > 0/);\n});\n''')
