import { canonicalCatalogBrand } from "./brands";
import { readStagingEncyclopediaCorpus } from "./encyclopedia";
import { presentCatalogOffer } from "./presentation";

type DisplayCarrier = { make?: unknown; model?: unknown; [key: string]: any };
type DisplayModel = { id: string; make: string; model: string; phrases: string[] };

type DisplayIdentity = {
  version: 1;
  rawMake: string;
  rawModel: string;
  modelId: string;
  canonicalMake: string;
  canonicalModel: string;
  match: "exact" | "prefix";
};

let indexPromise: Promise<Map<string, DisplayModel[]>> | null = null;

function clean(value: unknown) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function phrase(value: unknown) {
  return clean(value)
    .toLocaleLowerCase("en-US")
    .replace(/ё/g, "е")
    .replace(/&/g, " and ")
    .replace(/\+/g, " plus ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeAliasValues(rows: any) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && row.safe === true && clean(row.value))
    .map((row) => clean(row.value));
}

async function readIndex() {
  indexPromise ||= readStagingEncyclopediaCorpus().then((corpus) => {
    const byMake = new Map<string, DisplayModel[]>();
    for (const model of corpus.models) {
      const make = canonicalCatalogBrand(model.brandId);
      const phrases = [...new Set([
        clean(model.canonicalName),
        ...safeAliasValues((model as any).aliases),
        ...safeAliasValues((model as any).sourceNames),
      ].map(phrase).filter(Boolean))].sort((left, right) => right.length - left.length);
      if (!make || !phrases.length) continue;
      const key = phrase(make);
      const rows = byMake.get(key) || [];
      rows.push({ id: model.id, make, model: model.canonicalName, phrases });
      byMake.set(key, rows);
    }
    return byMake;
  });
  return indexPromise;
}

function duplicateParentheticalMake(value: string) {
  const match = value.match(/^(.+?)\s*\(\s*([^()]+)\s*\)$/u);
  if (!match) return value;
  return phrase(match[1]) === phrase(match[2]) ? clean(match[1]) : value;
}

function chooseModel(rows: DisplayModel[], rawModel: string) {
  const query = phrase(rawModel);
  if (!query) return null;
  const candidates: Array<{ row: DisplayModel; matched: string; kind: "exact" | "prefix" }> = [];
  for (const row of rows) {
    for (const candidate of row.phrases) {
      if (query === candidate) candidates.push({ row, matched: candidate, kind: "exact" });
      else if (query.startsWith(`${candidate} `)) candidates.push({ row, matched: candidate, kind: "prefix" });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((left, right) => Number(right.kind === "exact") - Number(left.kind === "exact") || right.matched.length - left.matched.length);
  const best = candidates[0];
  const sameRank = candidates.filter((item) => item.kind === best.kind && item.matched.length === best.matched.length);
  const ids = [...new Set(sameRank.map((item) => item.row.id))];
  return ids.length === 1 ? best : null;
}

export async function applyEncyclopediaDisplayIdentity<T extends DisplayCarrier>(offer: T): Promise<T & { encyclopediaDisplayIdentity?: DisplayIdentity }> {
  const presented = presentCatalogOffer(offer);
  const presentedMake = duplicateParentheticalMake(clean(presented.makeLabel || offer.make));
  const canonicalMake = canonicalCatalogBrand(presentedMake);
  const modelLabel = clean(presented.modelLabel || offer.model);
  const index = await readIndex();
  const rows = index.get(phrase(canonicalMake)) || [];
  const match = chooseModel(rows, modelLabel);
  if (!match) return offer as T & { encyclopediaDisplayIdentity?: DisplayIdentity };

  const rawMake = clean(offer.make);
  const rawModel = clean(offer.model);
  return {
    ...offer,
    make: match.row.make,
    model: match.row.model,
    encyclopediaDisplayIdentity: {
      version: 1,
      rawMake,
      rawModel,
      modelId: match.row.id,
      canonicalMake: match.row.make,
      canonicalModel: match.row.model,
      match: match.kind,
    },
  };
}

export async function applyEncyclopediaDisplayIdentityBatch<T extends DisplayCarrier>(offers: T[]) {
  return Promise.all(offers.map((offer) => applyEncyclopediaDisplayIdentity(offer)));
}
