import fs from "node:fs/promises";
import path from "node:path";

const { readEncyclopediaIdentityDataset, readEncyclopediaIdentityResolver } = await import("../apps/web/lib/catalog/encyclopedia-identity-data.ts");
const { applyEncyclopediaIdentityMaster } = await import("../apps/web/lib/catalog/encyclopedia-identity-master.ts");
const { enrichOfferWithVehicleKnowledge } = await import("../apps/web/lib/catalog/vehicle-knowledge.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");

const inputDir = process.env.CATALOG_REBUILD_INPUT_DIR || "catalog-v3-input";
const concurrency = Math.max(1, Math.min(32, Number(process.env.CATALOG_IDENTITY_PREPARE_CONCURRENCY || 24)));

// This is deliberately a publication-pipeline opt-in rather than the broad
// encyclopedia production switch. It lets canonical identity go live without
// declaring unfinished generation/specification content production-complete.
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

  // Re-run the existing calculation knowledge bridge only for identities that
  // actually changed. The normal publisher will calculate every candidate
  // afterwards; this step only gives it a second chance to obtain specs from a
  // now-canonical make/model without making publication network-dependent.
  if (changed && (!Number(offer.powerHp || 0) || !Number(offer.engineCc || 0) || !clean(offer.fuel))) {
    const before = {
      powerHp: Number(offer.powerHp || 0),
      engineCc: Number(offer.engineCc || 0),
      fuel: clean(offer.fuel),
    };
    try {
      const enriched = normalizeVehicleOfferSpecs(await enrichOfferWithVehicleKnowledge(offer));
      // The legacy knowledge bridge may fill missing technical data, but it is
      // not allowed to overrule the Encyclopedia Identity Master naming choice.
      offer = normalizeVehicleOfferSpecs({
        ...enriched,
        make: canonicalMake,
        model: canonicalModel,
        operational: {
          ...(enriched.operational || {}),
          encyclopediaIdentity: identity,
        },
      });
      knowledgeEnriched = Number(offer.powerHp || 0) !== before.powerHp
        || Number(offer.engineCc || 0) !== before.engineCc
        || clean(offer.fuel) !== before.fuel;
    } catch {
      // Identity is still useful even when the legacy knowledge bridge has no
      // matching specification. The publisher keeps its existing needs-data
      // safety semantics.
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
    },
  };
}

const names = (await fs.readdir(inputDir))
  .filter((name) => /^catalog-rebuild-.*-\d+\.json$/.test(name))
  .sort((left, right) => left.localeCompare(right, "en"));
if (!names.length) throw new Error(`catalog_identity_master_inputs_missing:${inputDir}`);

const summary = {
  version: 1,
  files: names.length,
  offers: 0,
  changed: 0,
  fullyResolved: 0,
  brandResolved: 0,
  modelResolved: 0,
  ambiguous: 0,
  translated: 0,
  knowledgeEnriched: 0,
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
    offers,
    identityMaster: {
      version: 1,
      appliedAt: new Date().toISOString(),
      sourceCheckpoint: dataset.manifest?.lastCheckpoint || null,
      ...fileStats,
    },
  };
  const temporary = `${filename}.identity-master.tmp`;
  await fs.writeFile(temporary, JSON.stringify(output, null, 2));
  await fs.rename(temporary, filename);
}

console.log(JSON.stringify(summary, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) {
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `### Encyclopedia Identity Master\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n`);
}
