import fs from "node:fs/promises";

const { readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { applyEncyclopediaDisplayIdentityBatch } = await import("../apps/web/lib/catalog/display-identity.ts");
const { catalogOfferTitle } = await import("../apps/web/lib/catalog/presentation.ts");
const { catalogBrandSlug } = await import("../apps/web/lib/catalog/brands.ts");
const { resolveCatalogBrandBySlug } = await import("../apps/web/lib/catalog/catalog-brand-directory.ts");

const OUTPUT = process.env.CATALOG_PUBLIC_IDENTITY_AUDIT_OUTPUT || "catalog-public-identity-audit.json";
const MARKETS = ["korea", "china", "japan", "uae", "europe", "georgia", "kyrgyzstan"];
const asianScript = /[\u1100-\u11ff\u3040-\u30ff\u3130-\u318f\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/u;

function clean(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function count(map, key) {
  map.set(key, Number(map.get(key) || 0) + 1);
}

function rows(map) {
  return [...map.entries()]
    .map(([key, offers]) => ({ key, offers }))
    .sort((left, right) => right.offers - left.offers || left.key.localeCompare(right.key, "ru"));
}

function sample(offer, publicOffer) {
  return {
    id: offer.id,
    sourceId: offer.sourceId,
    raw: { make: clean(offer.make), model: clean(offer.model) },
    public: { make: clean(publicOffer.make), model: clean(publicOffer.model), title: catalogOfferTitle(publicOffer) },
    totalRub: Number(offer.totalRub || 0),
    sourcePrice: Number(offer.sourcePrice || 0),
    sourceCurrency: clean(offer.sourceCurrency),
  };
}

const byMarket = await Promise.all(MARKETS.map(async (market) => ({ market, offers: await readMarketOffers(market) })));
const all = byMarket.flatMap((entry) => entry.offers || []);
const china = byMarket.find((entry) => entry.market === "china")?.offers || [];
const publicChina = await applyEncyclopediaDisplayIdentityBatch(china);
const rawPairs = new Map();
const publicPairs = new Map();
const publicMakes = new Map();
const unresolved = [];
const suspicious = [];
const mercedes = [];
const badBrandRoutes = [];
const routeCache = new Map();

for (let index = 0; index < china.length; index++) {
  const offer = china[index];
  const projected = publicChina[index];
  const rawPair = `${clean(offer.make)}\u0000${clean(offer.model)}`;
  const publicPair = `${clean(projected.make)}\u0000${clean(projected.model)}`;
  count(rawPairs, rawPair);
  count(publicPairs, publicPair);
  count(publicMakes, clean(projected.make));

  const title = catalogOfferTitle(projected);
  if (asianScript.test(`${clean(projected.make)} ${clean(projected.model)} ${title}`)) unresolved.push(sample(offer, projected));
  if (!clean(projected.make) || !clean(projected.model) || clean(projected.make) === clean(projected.model)
    || /^(?:EV|PHEV|HEV|BEV|PLUS|PRO|MAX)$/i.test(clean(projected.model))) suspicious.push(sample(offer, projected));
  if (/mercedes|benz|amg|vito|v class|奔驰/i.test(`${clean(offer.make)} ${clean(offer.model)} ${clean(offer.trim)} ${clean(projected.make)} ${clean(projected.model)}`)) {
    mercedes.push(sample(offer, projected));
  }

  const slug = catalogBrandSlug(projected.make);
  if (!routeCache.has(slug)) routeCache.set(slug, await resolveCatalogBrandBySlug(slug));
  if (!slug || !routeCache.get(slug)) badBrandRoutes.push(sample(offer, projected));
}

const price = {
  missingTotal: [],
  missingSourcePrice: [],
  missingCurrency: [],
  totalBelowSourceRub: [],
  preliminary: [],
};
for (const offer of all) {
  const sourceRub = Number(offer.calculationSnapshot?.currencyRate?.sourcePriceRub
    || offer.calculationSnapshot?.sourcePriceRub
    || offer.calculationSnapshot?.customsValue?.vehiclePriceRub
    || 0);
  const row = { id: offer.id, market: offer.market, make: offer.make, model: offer.model, totalRub: Number(offer.totalRub || 0), sourceRub };
  if (!(Number(offer.totalRub) > 0)) price.missingTotal.push(row);
  if (!(Number(offer.sourcePrice) > 0)) price.missingSourcePrice.push(row);
  if (!clean(offer.sourceCurrency)) price.missingCurrency.push(row);
  if (sourceRub > 0 && Number(offer.totalRub || 0) > 0 && Number(offer.totalRub) < sourceRub) price.totalBelowSourceRub.push(row);
  if (/preliminary|pending/i.test(`${offer.calculationStatus || ""} ${offer.calculationSnapshot?.pricingConfidence || ""}`)) price.preliminary.push(row);
}

const report = {
  version: 1,
  auditedAt: new Date().toISOString(),
  totals: { all: all.length, byMarket: Object.fromEntries(byMarket.map((entry) => [entry.market, entry.offers.length])), china: china.length },
  china: {
    rawMakeModelPairs: rawPairs.size,
    publicMakeModelPairs: publicPairs.size,
    publicMakes: rows(publicMakes),
    allRawPairs: rows(rawPairs).map((row) => ({ ...row, key: row.key.replace("\u0000", " / ") })),
    allPublicPairs: rows(publicPairs).map((row) => ({ ...row, key: row.key.replace("\u0000", " / ") })),
    unresolvedAsianScript: { count: unresolved.length, samples: unresolved.slice(0, 200) },
    suspiciousIdentity: { count: suspicious.length, samples: suspicious.slice(0, 200) },
    brokenBrandRoutes: { count: badBrandRoutes.length, samples: badBrandRoutes.slice(0, 200) },
    mercedesRelated: { count: mercedes.length, samples: mercedes.slice(0, 500) },
  },
  price: Object.fromEntries(Object.entries(price).map(([key, values]) => [key, { count: values.length, samples: values.slice(0, 200) }])),
};

await fs.writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  totals: report.totals,
  china: {
    rawMakeModelPairs: report.china.rawMakeModelPairs,
    publicMakeModelPairs: report.china.publicMakeModelPairs,
    unresolvedAsianScript: report.china.unresolvedAsianScript.count,
    suspiciousIdentity: report.china.suspiciousIdentity.count,
    brokenBrandRoutes: report.china.brokenBrandRoutes.count,
    mercedesRelated: report.china.mercedesRelated.count,
  },
  price: Object.fromEntries(Object.entries(report.price).map(([key, value]) => [key, value.count])),
}, null, 2));
