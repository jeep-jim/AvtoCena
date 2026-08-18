import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace, normalizeTerm, readJson, writeJson } from "./lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");
const LEGACY_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-knowledge");
const OUTPUT = path.join(DATA_ROOT, "reports/brand-registry-research.json");
const USER_AGENT = "AvtoCena-Encyclopedia/2.0 (https://avtocena.com)";

function catalogBrands(source) {
  const body = source.match(/const DROM_BRAND_NAMES = \[([\s\S]*?)\] as const;/)?.[1];
  if (!body) throw new Error("DROM_BRAND_NAMES was not found");
  return [...body.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((match) => JSON.parse(`"${match[1]}"`));
}

async function readLegacyCollection(collection) {
  const index = await readJson(path.join(LEGACY_ROOT, `${collection}-index.json`));
  const chunks = await Promise.all(index.chunks.map((chunk) => readJson(path.join(LEGACY_ROOT, chunk.file))));
  return chunks.flat();
}

async function dromBrandIndex() {
  const url = "https://www.drom.ru/catalog/";
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 AvtoCena-Encyclopedia/2.0" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Drom brand index failed: ${response.status}`);
  const html = new TextDecoder("windows-1251").decode(await response.arrayBuffer());
  const rows = [...html.matchAll(/<a[^>]+href="https?:\/\/www\.drom\.ru\/catalog\/([^/"?#]+)\/"[^>]*>([\s\S]*?)<\/a>/gi)].map((match) => ({
    slug: match[1],
    name: match[2].replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim(),
    url: `https://www.drom.ru/catalog/${match[1]}/`,
  }));
  return [...new Map(rows.filter((row) => row.name).map((row) => [`${row.slug}:${row.name}`, row])).values()];
}

function textKey(value) {
  return normalizeTerm(value).replace(/[^a-z0-9\p{L}\p{N}]+/gu, "");
}

function splitAltLabels(value) {
  return String(value || "").split(",").map((part) => part.trim()).filter(Boolean);
}

function sparqlString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"@en`;
}

async function wikidataBrands(catalogBrandNames) {
  const labelForms = [...new Set(catalogBrandNames.flatMap((brand) => [
    brand,
    `${brand} Auto`,
    `${brand} Automobile`,
    `${brand} Automobiles`,
    `${brand} Automotive`,
    `${brand} Cars`,
    `${brand} Group`,
    `${brand} Motor`,
    `${brand} Motors`,
  ]))];
  const carBrandQuery = `
SELECT ?item ?itemLabel ?itemAltLabel ?origin ?originLabel ?country ?countryLabel WHERE {
  ?item wdt:P31/wdt:P279* wd:Q10429667.
  OPTIONAL { ?item wdt:P495 ?origin. }
  OPTIONAL { ?item wdt:P17 ?country. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul,ru,zh,ja,ko". }
}`;
  const labelChunks = [];
  for (let offset = 0; offset < labelForms.length; offset += 80) labelChunks.push(labelForms.slice(offset, offset + 80));
  const manufacturerQueries = labelChunks.map((labels) => `
SELECT ?item ?itemLabel ?itemAltLabel ?origin ?originLabel ?country ?countryLabel WHERE {
  VALUES ?targetLabel { ${labels.map(sparqlString).join(" ")} }
  ?item wdt:P31 wd:Q786820;
        rdfs:label ?targetLabel.
  OPTIONAL { ?item wdt:P495 ?origin. }
  OPTIONAL { ?item wdt:P17 ?country. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul,ru,zh,ja,ko". }
}`);
  const queries = [carBrandQuery, ...manufacturerQueries];
  const bodies = await mapLimit(queries, 1, async (query) => {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await fetch("https://query.wikidata.org/sparql", {
        method: "POST",
        body: new URLSearchParams({ query, format: "json" }),
        headers: {
          accept: "application/sparql-results+json",
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          "user-agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(60_000),
      });
      if (response.ok) return response.json();
      if (![429, 502, 503, 504].includes(response.status) || attempt === 4) throw new Error(`Wikidata SPARQL failed: ${response.status}`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_500));
    }
    throw new Error("Wikidata SPARQL retry loop ended unexpectedly");
  });
  const grouped = new Map();
  for (const binding of bodies.flatMap((body) => body.results.bindings)) {
    const qid = binding.item.value.split("/").at(-1);
    const current = grouped.get(qid) || {
      qid,
      url: `https://www.wikidata.org/wiki/${qid}`,
      label: binding.itemLabel?.value || qid,
      aliases: new Set(),
      origins: new Map(),
      countries: new Map(),
    };
    for (const alias of splitAltLabels(binding.itemAltLabel?.value)) current.aliases.add(alias);
    if (binding.origin?.value) current.origins.set(binding.origin.value, binding.originLabel?.value || binding.origin.value.split("/").at(-1));
    if (binding.country?.value) current.countries.set(binding.country.value, binding.countryLabel?.value || binding.country.value.split("/").at(-1));
    grouped.set(qid, current);
  }
  return [...grouped.values()].map((row) => ({
    qid: row.qid,
    url: row.url,
    label: row.label,
    aliases: [...row.aliases].sort((a, b) => a.localeCompare(b, "en")),
    origins: [...row.origins].map(([uri, label]) => ({ uri, label })).sort((a, b) => a.label.localeCompare(b.label, "en")),
    countries: [...row.countries].map(([uri, label]) => ({ uri, label })).sort((a, b) => a.label.localeCompare(b.label, "en")),
  }));
}

function candidateMatches(brand, wikidata) {
  const key = textKey(brand);
  return wikidata.filter((row) => [row.label, ...row.aliases].some((name) => textKey(name) === key));
}

const GENERIC_BRAND_WORDS = new Set(["auto", "automobile", "automobiles", "automotive", "brand", "car", "cars", "company", "corporation", "group", "holding", "holdings", "industries", "marque", "motor", "motors"]);

function reducedBrandKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9\p{L}\p{N}]+/u)
    .filter((part) => part && !GENERIC_BRAND_WORDS.has(part))
    .join("");
}

function reducedCandidateMatches(brand, wikidata) {
  const key = reducedBrandKey(brand);
  if (!key) return [];
  return wikidata.filter((row) => [row.label, ...row.aliases].some((name) => reducedBrandKey(name) === key));
}

async function searchWikidata(query) {
  const url = new URL("https://www.wikidata.org/w/api.php");
  url.search = new URLSearchParams({
    action: "wbsearchentities",
    search: query,
    language: "en",
    uselang: "en",
    type: "item",
    limit: "10",
    format: "json",
    origin: "*",
  });
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Wikidata entity search failed for ${query}: ${response.status}`);
  const body = await response.json();
  return (body.search || []).map((row) => ({ qid: row.id, label: row.label || row.id, description: row.description || null, matched: row.match || null }));
}

async function mapLimit(values, limit, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return results;
}

async function fallbackCandidates(brand, validQids, wikidataByQid) {
  const queries = [
    `${brand} car brand`,
    `${brand} automobile brand`,
    `${brand} car manufacturer`,
    `${brand} Motors`,
    `${brand} Cars`,
  ];
  const searches = await mapLimit(queries, 2, async (query) => ({ query, results: await searchWikidata(query) }));
  const qids = [...new Set(searches.flatMap((row) => row.results.map((candidate) => candidate.qid)).filter((qid) => validQids.has(qid)))];
  return {
    queries: searches,
    candidates: qids.map((qid) => wikidataByQid.get(qid)),
  };
}

function groupRows(rows, field) {
  const map = new Map();
  for (const row of rows) {
    const key = normalizeTerm(row[field]);
    if (!key) continue;
    const values = map.get(key) || [];
    values.push(row);
    map.set(key, values);
  }
  return map;
}

const brandsSource = await readFile(path.join(REPO_ROOT, "apps/web/lib/catalog/brands.ts"), "utf8");
const brands = catalogBrands(brandsSource);
const [legacyModels, legacyVariants, v2, queue, wikidata, dromBrands] = await Promise.all([
  readLegacyCollection("models"),
  readLegacyCollection("variants"),
  loadWorkspace(DATA_ROOT),
  readJson(path.join(DATA_ROOT, "reports/brand-queue.json")),
  wikidataBrands(brands),
  dromBrandIndex(),
]);

const modelsByMake = groupRows(legacyModels, "make");
const variantsByMake = groupRows(legacyVariants, "make");
const v2ByName = new Map(v2.records.brand.flatMap((brand) => [brand.canonicalName, ...(brand.aliases || []).map((alias) => alias.value)].map((name) => [normalizeTerm(name), brand])));
const queueByBrand = new Map(queue.queue.map((row) => [row.brand, row]));
const dromByName = new Map(dromBrands.map((row) => [textKey(row.name), row]));

const wikidataByQid = new Map(wikidata.map((row) => [row.qid, row]));
const validQids = new Set(wikidataByQid.keys());
const records = brands.map((brand, index) => {
  const normalized = normalizeTerm(brand);
  const models = modelsByMake.get(normalized) || [];
  const variants = variantsByMake.get(normalized) || [];
  const v2Brand = v2ByName.get(normalized) || null;
  const exactCandidates = candidateMatches(brand, wikidata);
  const dromMatch = dromByName.get(textKey(brand)) || null;
  return {
    catalogPosition: index + 1,
    canonicalName: brand,
    v2BrandId: v2Brand?.id || null,
    v2Status: v2Brand?.status || null,
    priorityBatch: queueByBrand.get(brand)?.priorityBatch || "long-tail",
    legacy: {
      candidateModels: models.length,
      candidateVariants: variants.length,
      modelsWithoutProductionYears: models.filter((row) => !Number.isFinite(row.yearFrom) && !Number.isFinite(row.yearTo)).length,
      variantsWithoutProductionYears: variants.filter((row) => !Number.isFinite(row.yearFrom) && !Number.isFinite(row.yearTo)).length,
      uniqueModelNames: [...new Set(models.map((row) => row.model).filter(Boolean))].sort((a, b) => a.localeCompare(b, "en")),
    },
    wikidataExactCandidates: exactCandidates,
    wikidataReducedCandidates: exactCandidates.length ? [] : reducedCandidateMatches(brand, wikidata),
    wikidataSearch: null,
    dromIndexMatch: dromMatch,
    identitySeedSource: v2Brand ? "canonical_record" : dromMatch ? "drom_catalog_index" : "special_source_required",
    researchState: v2Brand ? "canonical_record_exists" : exactCandidates.length === 1 ? "single_exact_wikidata_candidate" : exactCandidates.length > 1 ? "ambiguous_exact_wikidata_candidates" : "manual_identity_search_required",
  };
});

for (const row of records) {
  if (row.researchState !== "manual_identity_search_required") continue;
  if (row.wikidataReducedCandidates.length === 1) row.researchState = "single_reduced_wikidata_candidate";
  else if (row.wikidataReducedCandidates.length > 1) row.researchState = "ambiguous_reduced_wikidata_candidates";
}

if (process.argv.includes("--search-api")) {
  const needsSearch = records.filter((row) => row.researchState === "manual_identity_search_required");
  const fallback = await mapLimit(needsSearch, 1, async (row) => ({
    canonicalName: row.canonicalName,
    result: await fallbackCandidates(row.canonicalName, validQids, wikidataByQid),
  }));
  const fallbackByBrand = new Map(fallback.map((row) => [row.canonicalName, row.result]));
  for (const row of records) {
    const searched = fallbackByBrand.get(row.canonicalName);
    if (!searched) continue;
    row.wikidataSearch = searched;
    if (searched.candidates.length === 1) row.researchState = "single_search_wikidata_candidate";
    else if (searched.candidates.length > 1) row.researchState = "ambiguous_search_wikidata_candidates";
  }
}

const report = {
  schemaVersion: 1,
  generatedAt: "2026-08-17",
  productionModified: false,
  rule: "This is a research denominator. Legacy names and Wikidata matches are candidates until reviewed and ingested with evidence.",
  wikidataQuery: {
    classes: ["Q10429667", "Q786820"],
    classLabels: ["car brand", "automobile manufacturer"],
    retrievedItems: wikidata.length,
    retrievedAt: "2026-08-17",
  },
  dromIndex: {
    url: "https://www.drom.ru/catalog/",
    retrievedLinks: dromBrands.length,
    retrievedAt: "2026-08-17",
  },
  legacyInventory: {
    attribution: "VehiclesDB (CC BY 4.0), built from official public registers",
    attributionUrl: "https://vehiclesdb.com",
    candidateModels: legacyModels.length,
    candidateModelsWithoutProductionYears: legacyModels.filter((row) => !Number.isFinite(row.yearFrom) && !Number.isFinite(row.yearTo)).length,
    candidateVariants: legacyVariants.length,
    candidateVariantsWithoutProductionYears: legacyVariants.filter((row) => !Number.isFinite(row.yearFrom) && !Number.isFinite(row.yearTo)).length,
    rule: "These rows are research candidates, not a deduplicated or market-complete canonical denominator.",
  },
  totals: {
    catalogBrands: records.length,
    canonicalBrandRecords: records.filter((row) => row.v2BrandId).length,
    brandsWithoutCanonicalRecord: records.filter((row) => !row.v2BrandId).length,
    dromIndexExactMatches: records.filter((row) => row.dromIndexMatch).length,
    brandsRequiringSpecialIdentitySource: records.filter((row) => !row.dromIndexMatch).length,
    singleExactWikidataCandidate: records.filter((row) => row.wikidataExactCandidates.length === 1).length,
    ambiguousExactWikidataCandidates: records.filter((row) => row.wikidataExactCandidates.length > 1).length,
    singleReducedWikidataCandidate: records.filter((row) => !row.wikidataExactCandidates.length && row.wikidataReducedCandidates.length === 1).length,
    ambiguousReducedWikidataCandidates: records.filter((row) => !row.wikidataExactCandidates.length && row.wikidataReducedCandidates.length > 1).length,
    singleSearchWikidataCandidate: records.filter((row) => row.researchState === "single_search_wikidata_candidate").length,
    ambiguousSearchWikidataCandidates: records.filter((row) => row.researchState === "ambiguous_search_wikidata_candidates").length,
    manualIdentitySearchRequired: records.filter((row) => !row.wikidataExactCandidates.length && !row.wikidataReducedCandidates.length).length,
    legacyCandidateModels: legacyModels.length,
    legacyCandidateVariants: legacyVariants.length,
  },
  records,
};

await writeJson(OUTPUT, report);
console.log(JSON.stringify({ built: true, output: path.relative(REPO_ROOT, OUTPUT), ...report.totals }, null, 2));
