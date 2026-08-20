import { canonicalCatalogBrand, catalogBrandBySlug, catalogBrandSlug } from "./brands";
import { readEncyclopediaIdentityDataset } from "./encyclopedia-identity-data";
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
  match: "exact" | "prefix" | "trusted_alias" | "translated" | "brand_only";
};

type DisplayIndex = { byMake: Map<string, DisplayModel[]>; allModels: DisplayModel[] };

let indexPromise: Promise<DisplayIndex> | null = null;

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
  indexPromise ||= readEncyclopediaIdentityDataset().then((dataset) => {
    const canonicalBrandNames = new Map((dataset?.brands || []).map((brand) => [brand.id, brand.canonicalName]));
    const byMake = new Map<string, DisplayModel[]>();
    const allModels: DisplayModel[] = [];
    for (const model of dataset?.models || []) {
      const make = canonicalCatalogBrand(canonicalBrandNames.get(model.brandId) || model.brandId);
      const phrases = [...new Set([
        clean(model.canonicalName),
        ...safeAliasValues((model as any).aliases),
        ...safeAliasValues((model as any).sourceNames),
      ].map(phrase).filter(Boolean))].sort((left, right) => right.length - left.length);
      if (!make || !phrases.length) continue;
      const key = phrase(make);
      const rows = byMake.get(key) || [];
      const row = { id: model.id, make, model: model.canonicalName, phrases };
      rows.push(row);
      allModels.push(row);
      byMake.set(key, rows);
    }
    return { byMake, allModels };
  });
  return indexPromise;
}

function duplicateParentheticalMake(value: string) {
  const match = value.match(/^(.+?)\s*\(\s*([^()]+)\s*\)$/u);
  if (!match) return value;
  return phrase(match[1]) === phrase(match[2]) ? clean(match[1]) : value;
}

function duplicateMakePrefixRemoved(make: string, model: string) {
  const normalizedMake = phrase(make);
  const normalizedModel = phrase(model);
  if (!normalizedMake || !normalizedModel) return model;
  if (normalizedModel === normalizedMake) return "";

  const makeWords = clean(make).split(/\s+/).filter(Boolean);
  const modelWords = clean(model).split(/\s+/).filter(Boolean);
  if (modelWords.length > makeWords.length
    && phrase(modelWords.slice(0, makeWords.length).join(" ")) === normalizedMake) {
    return clean(modelWords.slice(makeWords.length).join(" "));
  }
  return model;
}

function trustedCanonicalMake(value: string) {
  return canonicalCatalogBrand(value);
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

function uniqueChinaBaseModel(rows: DisplayModel[], offer: DisplayCarrier, rawModel: string) {
  const raw: any = offer?.operational?.raw || {};
  const evidence = [
    rawModel,
    offer?.sourceTitle,
    offer?.operational?.sourceTitle,
    raw?.title,
    raw?.model,
    raw?.Model,
    raw?.modelName,
    raw?.ModelName,
    raw?.seriesName,
    raw?.listing?.title,
    raw?.listing?.model,
    raw?.listing?.modelName,
    raw?.listing?.seriesName,
    raw?.offer?.Model,
    raw?.offer?.ModelName,
    raw?.detail?.model,
    raw?.detail?.modelName,
    raw?.detail?.seriesName,
  ].map(phrase).filter(Boolean);
  if (!evidence.length) return null;

  const matches: Array<{ row: DisplayModel; exact: boolean; length: number }> = [];
  for (const row of rows) {
    for (const candidate of row.phrases) {
      const cjkAlias = /[^\u0000-\u007f]/u.test(candidate) && candidate.replace(/\s+/g, "").length >= 2;
      const latinAlias = !cjkAlias && candidate.replace(/\s+/g, "").length >= 4;
      if (!cjkAlias && !latinAlias) continue;
      for (const value of evidence) {
        const exact = value === candidate;
        // A one-word Latin prefix such as "City" is not enough evidence to
        // move an offer to a different manufacturer. Cross-brand Latin
        // recovery requires either the full value or a multi-word identity.
        const bounded = cjkAlias || candidate.includes(" ")
          ? ` ${value} `.includes(` ${candidate} `)
          : false;
        const containedCjk = cjkAlias && value.includes(candidate);
        if (exact || bounded || containedCjk) matches.push({ row, exact, length: candidate.length });
      }
    }
  }
  if (!matches.length) return null;
  matches.sort((left, right) => Number(right.exact) - Number(left.exact) || right.length - left.length);
  const best = matches[0];
  const sameRank = matches.filter((item) => item.exact === best.exact && item.length === best.length);
  const ids = [...new Set(sameRank.map((item) => item.row.id))];
  return ids.length === 1 ? best.row : null;
}

function trustedChinaBaseVehicleIdentity(offer: DisplayCarrier, presentedMake: string, presentedModel: string) {
  if (clean(offer.market).toLowerCase() !== "china") return null;
  const raw: any = offer?.operational?.raw || {};
  const makeEvidence = phrase([offer.make, presentedMake].filter(Boolean).join(" "));
  const modelEvidence = phrase([
    offer.model,
    presentedModel,
    offer?.sourceTitle,
    offer?.operational?.sourceTitle,
    raw?.title,
    raw?.model,
    raw?.Model,
    raw?.modelName,
    raw?.ModelName,
    raw?.seriesName,
  ].filter(Boolean).join(" "));

  // These identities are model-name evidence, not a guess from the photo:
  // Vito/威霆 and V-Class/V级 are Mercedes-Benz product names. The coachbuilder
  // remains preserved in the source/internal object while the public card is
  // grouped under the base vehicle.
  if (/\bvito\b|威霆/u.test(modelEvidence)) return { make: "Mercedes-Benz", model: "Vito" };
  if (/\bv\s*class\b|v级/u.test(modelEvidence)) return { make: "Mercedes-Benz", model: "V-Class" };

  // The documented City H7 and the source-backed City S9 listing are Toyota
  // Hiace conversions. Do not broaden this rule to arbitrary WALD products.
  if (/\bwald\b/u.test(makeEvidence) && /\bcity\s+(?:h7|s9)\b/u.test(modelEvidence)) {
    return { make: "Toyota", model: "Hiace" };
  }
  return null;
}

function trustedCanonicalModel(make: string, model: string) {
  const rules: Array<{ make: RegExp; model: RegExp; canonical: string }> = [
    // Hyundai and KGM publish these exact English model identities on their
    // official sites; source listing suffixes are trims/powertrains, not models.
    { make: /^Hyundai$/i, model: /^(?:The New |The All New )?Grandeur\b/i, canonical: "Grandeur" },
    { make: /^KGM$/i, model: /^(?:The New )?Rexton Sports Khan\b/i, canonical: "Rexton Sports Khan" },
    { make: /^HuangHai$/i, model: /^Jiaolong EV\b/i, canonical: "Jiaolong EV" },
  ];
  return rules.find((rule) => rule.make.test(make) && rule.model.test(model))?.canonical || "";
}

function hasUnresolvedAsianScript(value: string) {
  return /[\u1100-\u11ff\u3040-\u30ff\u3130-\u318f\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\ua960-\ua97f\uac00-\ud7af\uf900-\ufaff]/u.test(value);
}

export async function applyEncyclopediaDisplayIdentity<T extends DisplayCarrier>(offer: T): Promise<T & { encyclopediaDisplayIdentity?: DisplayIdentity }> {
  const presented = presentCatalogOffer(offer);
  const presentedMake = duplicateParentheticalMake(clean(presented.makeLabel || offer.make));
  const canonicalMake = trustedCanonicalMake(presentedMake);
  const modelLabel = duplicateMakePrefixRemoved(presentedMake, clean(presented.modelLabel || offer.model));
  const index = await readIndex();
  const trustedBase = trustedChinaBaseVehicleIdentity(offer, presentedMake, modelLabel);
  if (trustedBase) {
    const baseRows = index.byMake.get(phrase(trustedBase.make)) || [];
    const baseMatch = chooseModel(baseRows, trustedBase.model);
    const rawMake = clean(offer.make);
    const rawModel = clean(offer.model);
    return {
      ...offer,
      make: trustedBase.make,
      model: trustedBase.model,
      encyclopediaDisplayIdentity: {
        version: 1,
        rawMake,
        rawModel,
        modelId: baseMatch?.row.id || "",
        canonicalMake: trustedBase.make,
        canonicalModel: trustedBase.model,
        match: "trusted_alias",
      },
    };
  }
  const rows = index.byMake.get(phrase(canonicalMake)) || [];
  const match = chooseModel(rows, modelLabel);
  const rawMake = clean(offer.make);
  const rawModel = clean(offer.model);
  if (!match) {
    const knownPresentedBrand = Boolean(catalogBrandBySlug(catalogBrandSlug(canonicalMake)));
    const baseModel = clean(offer.market).toLowerCase() === "china" && !knownPresentedBrand
      ? uniqueChinaBaseModel(index.allModels, offer, rawModel)
      : null;
    if (baseModel && phrase(baseModel.make) !== phrase(canonicalMake)) {
      return {
        ...offer,
        make: baseModel.make,
        model: baseModel.model,
        encyclopediaDisplayIdentity: {
          version: 1,
          rawMake,
          rawModel,
          modelId: baseModel.id,
          canonicalMake: baseModel.make,
          canonicalModel: baseModel.model,
          match: "trusted_alias",
        },
      };
    }
    const trustedModel = trustedCanonicalModel(canonicalMake, modelLabel);
    const translated = Boolean(canonicalMake && modelLabel
      && !hasUnresolvedAsianScript(canonicalMake)
      && !hasUnresolvedAsianScript(modelLabel)
      && (phrase(canonicalMake) !== phrase(rawMake) || phrase(modelLabel) !== phrase(rawModel)));
    // A known brand translation is independently safe even when a localized
    // model name is not in the maintained model directory yet. Canonicalize
    // the public brand group, but preserve the source model verbatim rather
    // than inventing a model identity from an incomplete translation.
    const brandOnly = Boolean(canonicalMake
      && !hasUnresolvedAsianScript(canonicalMake)
      && phrase(canonicalMake) !== phrase(rawMake));
    if (!trustedModel && !translated && !brandOnly) return offer as T & { encyclopediaDisplayIdentity?: DisplayIdentity };
    const canonicalModel = trustedModel || (translated ? modelLabel : rawModel);
    return {
      ...offer,
      make: canonicalMake,
      model: canonicalModel,
      encyclopediaDisplayIdentity: {
        version: 1,
        rawMake,
        rawModel,
        modelId: "",
        canonicalMake,
        canonicalModel,
        match: trustedModel ? "trusted_alias" : translated ? "translated" : "brand_only",
      },
    };
  }

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
