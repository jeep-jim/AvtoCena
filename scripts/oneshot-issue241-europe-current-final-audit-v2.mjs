import fs from "node:fs/promises";

// Run the full read-only audit first. Its v1 Mercedes check intentionally compared
// every source model spelling with our canonical naming and therefore treated
// valid source families such as `GLA` vs `GLA Class` as malformed. Re-evaluate
// only the actual failure class from issue #241: a generic Mercedes/Benz model
// that the source title can deterministically resolve to a specific family.
await import("./oneshot-issue241-europe-current-final-audit.mjs");

const { getJsonStorage } = await import("../apps/web/lib/data.ts");
const { canonicalSourceModelIdentity } = await import("../apps/web/lib/catalog/open-source-normalizer.ts");
const { offerPath } = await import("../apps/web/lib/catalog/storage.ts");

function clean(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function semanticKey(value) { return clean(value).toLocaleLowerCase("en-US").replace(/[^a-z0-9а-яё]+/gi, ""); }
function titleText(offer) {
  return clean(offer?.sourceTitle || offer?.operational?.sourceTitle || offer?.title || [offer?.make, offer?.model, offer?.trim].filter(Boolean).join(" "));
}
function genericMercedesModel(value) {
  return /^(?:benz|mercedes|mercedes[-\s]+benz)$/i.test(clean(value));
}

const storage = getJsonStorage();
const manifest = await storage.readJson("catalog/manifest.json", null);
if (!manifest?.generationId || !manifest?.markets?.europe) throw new Error("current_europe_manifest_missing");
const europe = [];
for (const chunk of manifest.markets.europe.chunks || []) {
  const rows = await storage.readJson(offerPath(manifest.generationId, "europe", chunk), null);
  if (!Array.isArray(rows)) throw new Error(`current_europe_chunk_invalid:${chunk}`);
  europe.push(...rows);
}

const malformed = europe.filter((offer) => {
  const model = clean(offer?.model);
  if (!genericMercedesModel(model)) return false;
  const make = clean(offer?.make);
  if (!/mercedes|benz/i.test(`${make} ${model}`)) return false;
  const canonical = clean(canonicalSourceModelIdentity(titleText(offer), make, model));
  return canonical && semanticKey(canonical) !== semanticKey(model);
});

const report = JSON.parse(await fs.readFile("issue241-europe-current-final-audit.json", "utf8"));
report.europe.provableMalformedMercedes = malformed.length;
report.europe.malformedMercedesSample = malformed.slice(0, 20).map((row) => ({
  id: row.id,
  make: row.make,
  model: row.model,
  sourceTitle: titleText(row),
  canonical: canonicalSourceModelIdentity(titleText(row), row.make, row.model),
}));
report.europe.malformedMercedesRule = "generic Benz/Mercedes model only; canonical family spelling differences such as GLA vs GLA Class are valid";
report.failures = (report.failures || []).filter((failure) => !String(failure).startsWith("europe_provable_mercedes_identity:"));
if (malformed.length) report.failures.push(`europe_provable_mercedes_identity:${malformed.length}`);
await fs.writeFile("issue241-europe-current-final-audit.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ correctedMercedesAudit: true, provableMalformedMercedes: malformed.length, failures: report.failures }, null, 2));
process.exitCode = report.failures.length ? 1 : 0;
