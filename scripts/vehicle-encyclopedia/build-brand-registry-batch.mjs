import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson, writeJson } from "./lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");
const RESEARCH_FILE = path.join(DATA_ROOT, "reports/brand-registry-research.json");
const OUTPUT_FILE = path.join(DATA_ROOT, "ingest/brand-registry-2026-08-17.json");
const VERIFIED_AT = "2026-08-17";

const SOURCES = {
  drom: {
    id: "src-drom-brand-catalog-index-2026",
    type: "authoritative_catalog",
    title: "Каталог автомобилей — марки",
    publisher: "Drom",
    url: "https://www.drom.ru/catalog/",
    documentId: null,
    documentDate: null,
    verifiedAt: VERIFIED_AT,
    market: "Global",
    language: "ru",
    supportedFields: ["canonicalName"],
    confidence: "high",
    status: "active",
    license: null,
    notes: "The catalog index displayed an exact brand-name match for 181 of the 185 current AvtoCena catalog brands. It is used only as an identity seed, not as proof of country, model range or technical specifications.",
  },
  eagle: {
    id: "src-wikidata-eagle-automobile-brand-q1203417",
    type: "wikidata",
    title: "Eagle",
    publisher: "Wikidata",
    url: "https://www.wikidata.org/wiki/Q1203417",
    documentId: "Q1203417",
    documentDate: null,
    verifiedAt: VERIFIED_AT,
    market: "Global",
    language: "en",
    supportedFields: ["canonicalName", "countries"],
    confidence: "high",
    status: "active",
    license: "CC0 1.0",
    notes: "Wikidata identifies Eagle as an automobile marque from the United States. The record is retained as a long-tail identity seed.",
  },
  liAuto: {
    id: "src-li-auto-about-2026",
    type: "manufacturer",
    title: "Hello! We Are Li Auto",
    publisher: "Li Auto",
    url: "https://www.liauto.com/about.html",
    documentId: null,
    documentDate: null,
    verifiedAt: VERIFIED_AT,
    market: "Global",
    language: "en",
    supportedFields: ["canonicalName"],
    confidence: "official",
    status: "active",
    license: null,
    notes: "The official manufacturer page explicitly uses Li Auto as the brand name. Country is intentionally left unresolved in this identity-only seed.",
  },
  neta: {
    id: "src-neta-auto-prnewswire-2024",
    type: "secondary_reference",
    title: "NETA V-II Makes Stunning Debut at Bangkok",
    publisher: "NETA AUTO / PR Newswire",
    url: "https://www.prnewswire.com/apac/news-releases/neta-v-ii-makes-stunning-debut-at-bangkok-as-brand-continues-flourishing-in-thailand-302102661.html",
    documentId: null,
    documentDate: "2024-03-28",
    verifiedAt: VERIFIED_AT,
    market: "Global",
    language: "en",
    supportedFields: ["canonicalName"],
    confidence: "high",
    status: "active",
    license: null,
    notes: "Manufacturer-origin press release distributed by PR Newswire includes an About NETA Auto section. It supports only the English brand identity in this seed.",
  },
  proton: {
    id: "src-proton-about-us-2026",
    type: "manufacturer",
    title: "PROTON — About Us",
    publisher: "PROTON Holdings Berhad",
    url: "https://www.proton.com/corporate/about-us",
    documentId: null,
    documentDate: null,
    verifiedAt: VERIFIED_AT,
    market: "Global",
    language: "en",
    supportedFields: ["canonicalName", "countries"],
    confidence: "official",
    status: "active",
    license: null,
    notes: "The official company page describes PROTON as Malaysia's national car project and automotive brand.",
  },
};

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function entityId(name, slug) {
  return ({ AC: "ac-cars", MG: "mg-motor", ZX: "zx-auto" })[name] || slug;
}

function sourceFor(record) {
  if (record.dromIndexMatch) return SOURCES.drom;
  if (record.canonicalName === "Eagle") return SOURCES.eagle;
  if (record.canonicalName === "Li Auto") return SOURCES.liAuto;
  if (record.canonicalName === "Neta") return SOURCES.neta;
  if (record.canonicalName === "Proton") return SOURCES.proton;
  throw new Error(`No identity source for ${record.canonicalName}`);
}

function countriesFor(name) {
  if (name === "Eagle") return ["United States"];
  if (name === "Proton") return ["Malaysia"];
  return [];
}

const [research, workspace] = await Promise.all([readJson(RESEARCH_FILE), loadWorkspace(DATA_ROOT)]);
const registrySourceIds = new Set(Object.values(SOURCES).map((source) => source.id));
const existingByName = new Map(workspace.records.brand.flatMap((brand) => [brand.canonicalName, ...(brand.aliases || []).map((alias) => alias.value)].map((name) => [name, brand])));
const pending = research.records.filter((record) => {
  if (!record.v2BrandId) return true;
  const existing = existingByName.get(record.canonicalName);
  return existing?.evidence.some((item) => registrySourceIds.has(item.sourceId));
});
if (pending.length !== 145) {
  throw new Error(`Expected 145 missing brands, found ${pending.length}`);
}

const brands = pending.map((record) => {
  const source = sourceFor(record);
  const slug = slugify(record.canonicalName);
  const countries = countriesFor(record.canonicalName);
  return {
    id: entityId(record.canonicalName, slug),
    canonicalName: record.canonicalName,
    slug,
    aliases: [],
    countries,
    status: "seed",
    evidence: [{
      sourceId: source.id,
      fields: countries.length ? ["canonicalName", "countries"] : ["canonicalName"],
      status: "verified",
      confidence: source.confidence,
      note: countries.length
        ? "Source-backed brand identity and country; models, generations and variants remain pending."
        : "Source-backed brand identity only; country, models, generations and variants remain pending.",
    }],
    researchNotes: [
      "Registry seed only. This brand is not complete until its in-window model, generation, grade and powertrain inventory is checked against primary sources and active-listing identities.",
    ],
    updatedAt: VERIFIED_AT,
  };
});

const allIds = new Set();
for (const brand of brands) {
  if (allIds.has(brand.id)) throw new Error(`Brand ID collision: ${brand.id}`);
  allIds.add(brand.id);
  const existing = workspace.records.brand.find((row) => row.id === brand.id);
  if (existing && existing.canonicalName !== brand.canonicalName) throw new Error(`Existing brand ID collision: ${brand.id}`);
}

const batch = {
  schemaVersion: 2,
  batches: [
    { schemaVersion: 2, entityType: "source", chunk: 1, maxRecords: 250, records: Object.values(SOURCES) },
    { schemaVersion: 2, entityType: "brand", chunk: 1, maxRecords: 250, records: brands },
  ],
};

await writeJson(OUTPUT_FILE, batch);
console.log(JSON.stringify({ built: true, output: path.relative(REPO_ROOT, OUTPUT_FILE), sources: Object.keys(SOURCES).length, brands: brands.length, withCountries: brands.filter((brand) => brand.countries.length).length, countryPending: brands.filter((brand) => !brand.countries.length).length }, null, 2));
