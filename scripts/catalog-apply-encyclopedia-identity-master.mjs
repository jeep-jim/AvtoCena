import fs from "node:fs/promises";
import path from "node:path";
import { writeJsonObjectWithArrayAtomic } from "./lib/write-json-object-with-array.mjs";

const { readEncyclopediaIdentityDataset, readEncyclopediaIdentityResolver } = await import("../apps/web/lib/catalog/encyclopedia-identity-data.ts");
const { applyEncyclopediaIdentityMaster } = await import("../apps/web/lib/catalog/encyclopedia-identity-master.ts");
const { enrichOfferWithKnowledgeCore } = await import("../apps/web/lib/catalog/knowledge-core.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");

const inputDir = process.env.CATALOG_REBUILD_INPUT_DIR || "catalog-v3-input";
const concurrency = Math.max(1, Math.min(32, Number(process.env.CATALOG_IDENTITY_PREPARE_CONCURRENCY || 24)));

if (process.env.CATALOG_ENCYCLOPEDIA_IDENTITY_MASTER !== "1") {
  throw new Error("catalog_encyclopedia_identity_master_not_enabled");
}

const dataset = await readEncyclopediaIdentityDataset();
if (!dataset) throw new Error("catalog_encyclopedia_identity_dataset_unavailable:master");
const resolver = await readEncyclopediaIdentityResolver();
if (!resolver) throw new Error("catalog_encyclopedia_identity_resolver_unavailable:master");

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function identityMeta(offer) {
  return offer?.operational?.encyclopediaIdentity || {};
}

async function pool(rows, limit, worker) {
  if (!rows.length) return [];
  const output = new Array(rows.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= rows.length) return;
      output[index] = await worker(rows[index], index);
    }
  }));
  return output;
}

async function applyOffer(rawOffer) {
  const sourceMake = clean(rawOffer?.make);
  const sourceModel = clean(rawOffer?.model);
  let offer = normalizeVehicleOfferSpecs(rawOffer);
  offer = normalizeVehicleOfferSpecs(applyEncyclopediaIdentityMaster(resolver, offer));
  const identity = identityMeta(offer);
  const canonicalMake = clean(offer.make);
  const canonicalModel = clean(offer.model);
  const changed = canonicalMake !== sourceMake || canonicalModel !== sourceModel;
  let knowledgeEnriched = false;
  let exactCoreVariant = false;

  // Every canonically resolved model gets one deterministic CORE enrichment
  // pass. This is intentionally not limited to renamed offers or to three
  // missing fields: body, drive, transmission and electrified power matter to
  // both the calculator and public cards too.
  if (identity.canonicalModelId) {
    const before = {
      powerHp: Number(offer.powerHp || 0),
      engineCc: Number(offer.engineCc || 0),
      fuel: clean(offer.fuel),
      bodyType: clean(offer.bodyType),
      transmission: clean(offer.transmission),
      drive: clean(offer.drive),
      power30MinKw: Number(offer.power30MinKw || 0),
    };
    try {
      const enriched = normalizeVehicleOfferSpecs(await enrichOfferWithKnowledgeCore(offer));
      offer = normalizeVehicleOfferSpecs({
        ...enriched,
        make: canonicalMake,
        model: canonicalModel,
        operational: {
          ...(enriched.operational || {}),
          encyclopediaIdentity: identity,
        },
      });
      exactCoreVariant = Boolean(offer?.operational?.knowledgeCore?.variantId);
      knowledgeEnriched = exactCoreVariant
        || Number(offer.powerHp || 0) !== before.powerHp
        || Number(offer.engineCc || 0) !== before.engineCc
        || clean(offer.fuel) !== before.fuel
        || clean(offer.bodyType) !== before.bodyType
        || clean(offer.transmission) !== before.transmission
        || clean(offer.drive) !== before.drive
        || Number(offer.power30MinKw || 0) !== before.power30MinKw;
    } catch {
      // Identity is still useful even when no trusted exact variant can be
      // matched. The knowledge-gap report records this instead of guessing.
    }
  }

  return {
    offer,
    stats: {
      changed,
      fullyResolved: identity.fullyResolved === true,
      brandResolved: Boolean(identity.canonicalBrandId),
      modelResolved: Boolean(identity.canonicalModelId),
      ambiguous: identity.ambiguous === true,
      translated: String(identity.makeSource || "").startsWith("presentation:")
        || String(identity.modelSource || "").startsWith("presentation:"),
      knowledgeEnriched,
      exactCoreVariant,
    },
  };
}

const names = (await fs.readdir(inputDir))
  .filter((name) => /^catalog-rebuild-.*-\d+\.json$/.test(name))
  .sort((left, right) => left.localeCompare(right, "en"));
if (!names.length) throw new Error(`catalog_identity_master_inputs_missing:${inputDir}`);

const summary = {
  version: 2,
  files: names.length,
  offers: 0,
  changed: 0,
  fullyResolved: 0,
  brandResolved: 0,
  modelResolved: 0,
  ambiguous: 0,
  translated: 0,
  knowledgeEnriched: 0,
  exactCoreVariant: 0,
  resolverCollisions: resolver.collisions.length,
};

for (const name of names) {
  const filename = path.join(inputDir, name);
  const payload = JSON.parse(await fs.readFile(filename, "utf8"));
  if (!Array.isArray(payload?.offers)) throw new Error(`catalog_identity_master_offers_missing:${name}`);
  const beforeIds = payload.offers.map((offer) => String(offer?.id || ""));
  const applied = await pool(payload.offers, concurrency, applyOffer);
  const offers = applied.map((item) => item.offer);
  const afterIds = offers.map((offer) => String(offer?.id || ""));
  if (beforeIds.length !== afterIds.length || beforeIds.some((id, index) => id !== afterIds[index])) {
    throw new Error(`catalog_identity_master_offer_identity_changed:${name}`);
  }

  const fileStats = {
    offers: offers.length,
    changed: 0,
    fullyResolved: 0,
    brandResolved: 0,
    modelResolved: 0,
    ambiguous: 0,
    translated: 0,
    knowledgeEnriched: 0,
    exactCoreVariant: 0,
  };
  for (const { stats } of applied) {
    for (const key of Object.keys(fileStats)) {
      if (key === "offers") continue;
      if (stats[key]) fileStats[key]++;
    }
  }
  for (const key of Object.keys(fileStats)) summary[key] += fileStats[key];

  const output = {
    ...payload,
    identityMaster: {
      version: 2,
      appliedAt: new Date().toISOString(),
      sourceCheckpoint: dataset.manifest?.lastCheckpoint || null,
      ...fileStats,
    },
  };
  await writeJsonObjectWithArrayAtomic(filename, output, "offers", offers);
}

console.log(JSON.stringify(summary, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) {
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `### Encyclopedia Identity Master + Knowledge CORE\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n`);
}
