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

/**
 * AutoPapa's live asking price is rendered beside the primary vehicle title,
 * but the current detail HTML does not consistently use an H1 element. Bind the
 * price to this offer's exact make/model inside the primary region and stop
 * before AutoPapa's customs-helper blocks. Recommendation cards and seller text
 * later on the page are therefore unable to donate a price.
 */
export function autoPapaDetailPriceUsd(markup: string, identity?: Pick<VehicleOffer, "make" | "model">) {
  const text = plain(markup);
  const helperIndex = text.search(/\bSTARTING\s+PRICE\s+(?:AT|IN)\b/i);
  const factsIndex = text.search(/\bBody\s+Type\s*:/i);
  const primaryEnd = helperIndex >= 0 ? helperIndex : factsIndex >= 0 ? factsIndex : Math.min(text.length, 6_000);
  const primary = text.slice(0, primaryEnd);
  const title = [identity?.make, identity?.model].map((value) => String(value || "").trim()).filter(Boolean).join(" ");

  if (title) {
    const pattern = new RegExp(title.split(/\s+/).map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "ig");
    const matches = [...primary.matchAll(pattern)];
    for (let index = matches.length - 1; index >= 0; index--) {
      const match = matches[index];
      const start = Number(match.index || 0) + match[0].length;
      const price = autoPapaSinglePriceToken(primary.slice(start, Math.min(primary.length, start + 320)));
      if (price) return price;
    }
  }

  return autoPapaSinglePriceToken(primary.slice(Math.max(0, primary.length - 900)));
}
'''
if old not in text:
    raise SystemExit('old AutoPapa price parser not found')
text = text.replace(old, new, 1)
text = text.replace('const priceUsd = autoPapaDetailPriceUsd(markup);', 'const priceUsd = autoPapaDetailPriceUsd(markup, offer);', 1)
source.write_text(text)

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
    text = text.replace(anchor, anchor + '''function hasVerifiedAutoPapaPrice(offer) {\n  if (String(offer?.sourceId || "") !== "autopapa_georgia_open") return true;\n  const raw = offer?.operational?.raw || {};\n  const exact = Number(raw?.autoPapaDetailPriceUsd || 0);\n  return raw?.autoPapaDetailPriceVerified === true\n    && exact > 0\n    && Math.round(Number(offer?.sourcePrice || 0)) === Math.round(exact);\n}\n''', 1)

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

old = '  const powerBeforeKnowledge = Number(offer.powerHp || 0);\n'
new = '''  if (sourceId === "autopapa_georgia_open") {\n    const raw = { ...(offer.operational?.raw || {}) };\n    delete raw.autoPapaDetailPriceVerified;\n    delete raw.autoPapaDetailPriceUsd;\n    offer.operational = { ...offer.operational, raw };\n  }\n\n  const powerBeforeKnowledge = Number(offer.powerHp || 0);\n'''
if old in text:
    text = text.replace(old, new, 1)
elif 'delete raw.autoPapaDetailPriceVerified' not in text:
    raise SystemExit('AutoPapa verification reset anchor missing')

old = '  const detailNeeded = mandatoryPhotoMissing || criticalSpecsMissing || priorityGalleryMissing;\n'
new = '  const detailFactsNeeded = needsSourceDetailFactRefresh(offer);\n  const detailNeeded = mandatoryPhotoMissing || criticalSpecsMissing || priorityGalleryMissing || detailFactsNeeded;\n'
if old in text:
    text = text.replace(old, new, 1)
elif 'const detailFactsNeeded = needsSourceDetailFactRefresh(offer);' not in text:
    raise SystemExit('detailNeeded anchor missing')

old = '  if (gallery.length < minimumImages) { reject(detailDeferredForOffer ? "images_detail_budget" : "images"); return null; }\n'
new = '  if (detailFactsNeeded && !hasVerifiedAutoPapaPrice(offer)) { reject("source_detail_price"); return null; }\n' + old
if old in text:
    text = text.replace(old, new, 1)
elif 'reject("source_detail_price")' not in text:
    raise SystemExit('post-detail price gate missing')
rebuild.write_text(text)

ci = Path('.github/workflows/ci.yml')
text = ci.read_text()
old = 'tests/autopapa-georgia-current-parser-20260812.test.ts tests/catalog-preliminary-power-recovery.test.ts'
new = 'tests/autopapa-georgia-current-parser-20260812.test.ts tests/catalog-autopapa-detail-refresh.test.ts tests/catalog-autopapa-v3-price-authority.test.ts tests/catalog-preliminary-power-recovery.test.ts'
if old in text:
    text = text.replace(old, new, 1)
elif 'tests/catalog-autopapa-v3-price-authority.test.ts' not in text:
    raise SystemExit('CI Georgia test anchor missing')
ci.write_text(text)
