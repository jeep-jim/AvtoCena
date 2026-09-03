import fs from "node:fs/promises";

const { catalogPublicPriority, catalogRequiredSpecificationRejectionReason } =
  await import("../apps/web/lib/catalog/public-priority.ts");
const { SPECIFICATION_AUDIT_FIELDS, classifySpecificationEvidence } =
  await import("../apps/web/lib/catalog/specification-evidence-audit.ts");
const { isPreliminaryPowerPendingCalculation } =
  await import("../apps/web/lib/catalog/customs-pricing.ts");

const input = process.env.RECOVERY_OUTPUT || "catalog-rebuild.json";
const output =
  process.env.RECOVERY_AUDIT_OUTPUT || "catalog-four-market-exact-audit.json";
const expectedMarket = String(process.env.RECOVERY_MARKET || "").trim();
const expectedSources = String(process.env.RECOVERY_SOURCE_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const minimumImages = Math.max(
  1,
  Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 5),
);
const sampleLimit = Math.max(
  10,
  Math.min(250, Number(process.env.RECOVERY_AUDIT_SAMPLE_LIMIT || 100)),
);

const BODY_VALUES = new Set([
  "sedan",
  "saloon",
  "hatchback",
  "liftback",
  "fastback",
  "suv",
  "crossover",
  "offroad",
  "wagon",
  "estate",
  "coupe",
  "convertible",
  "cabriolet",
  "roadster",
  "pickup",
  "minivan",
  "mpv",
  "van",
]);
const EXPECTED_HOSTS = {
  encar_direct: ["encar.com"],
  kcar_korea_open: ["kcar.com"],
  dubizzle_uae_open: ["dubizzle.com"],
  dubicars_uae_exact: ["dubicars.com"],
  autoscout_europe_open: [
    "autoscout24.com",
    "autoscout24.de",
    "autoscout24.it",
    "autoscout24.fr",
    "autoscout24.nl",
  ],
  mobile_de_open: ["mobile.de"],
  myauto_georgia_list: ["myauto.ge"],
  autopapa_georgia_open: ["autopapa.ge"],
};

if (!expectedMarket) throw new Error("recovery_market_missing");
if (!expectedSources.length) throw new Error("recovery_source_ids_missing");

function hostAllowed(sourceId, value) {
  const allowed = EXPECTED_HOSTS[sourceId] || [];
  try {
    const host = new URL(String(value || "")).hostname.toLowerCase();
    return allowed.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    );
  } catch {
    return false;
  }
}

function imageKey(image) {
  return String(
    image?.checksum || image?.id || image?.objectKey || image?.url || "",
  ).trim();
}

function exactFieldStates(offer) {
  return Object.fromEntries(
    SPECIFICATION_AUDIT_FIELDS.map((field) => [
      field,
      classifySpecificationEvidence(offer, field),
    ]),
  );
}

function offerProblems(offer) {
  const problems = [];
  if (
    !offer?.id ||
    !offer?.sourceOfferId ||
    !offer?.make ||
    !offer?.model ||
    !offer?.year
  )
    problems.push("identity_missing");
  if (offer?.market !== expectedMarket) problems.push("market_mismatch");
  if (!expectedSources.includes(String(offer?.sourceId || "")))
    problems.push("source_not_allowed");
  if (!hostAllowed(offer?.sourceId, offer?.operational?.sourceUrl))
    problems.push("source_url_host_mismatch");
  if (
    !(Number(offer?.sourcePrice || 0) > 0) ||
    !String(offer?.sourceCurrency || "").trim()
  )
    problems.push("source_price_missing");

  const body = String(offer?.bodyType || "")
    .trim()
    .toLowerCase();
  if (!body) problems.push("body_missing");
  else if (!BODY_VALUES.has(body)) problems.push("body_noncanonical");

  const images = Array.isArray(offer?.images) ? offer.images : [];
  const uniqueImages = new Set(images.map(imageKey).filter(Boolean));
  if (images.length < minimumImages) problems.push("gallery_below_minimum");
  if (uniqueImages.size !== images.length) problems.push("gallery_duplicates");

  const states = exactFieldStates(offer);
  for (const [field, result] of Object.entries(states)) {
    const accepted =
      result.state === "exact" ||
      (result.state === "not_applicable" &&
        ["engineCc", "certifiedPower"].includes(field));
    if (!accepted) problems.push(`${field}_${result.state}_${result.reason}`);
  }

  const raw = offer?.operational?.raw || {};
  if (raw.recoveryExactSourceUrl !== true)
    problems.push("exact_source_url_attestation_missing");
  if (raw.recoveryExactPhotoIdentity !== true)
    problems.push("exact_photo_identity_attestation_missing");
  if (raw.recoveryBodySourceOnly !== true)
    problems.push("source_only_body_attestation_missing");
  if (raw.recoveryStrictPublicReady !== true)
    problems.push("strict_mode_attestation_missing");
  if (
    isPreliminaryPowerPendingCalculation(offer) ||
    offer?.calculationSnapshot?.pricingConfidence === "preliminary"
  )
    problems.push("preliminary_calculation");
  const customs = offer?.calculationSnapshot?.customs;
  if (
    customs?.status !== "ready" ||
    !Number.isFinite(Number(customs?.totalCustomsRub))
  )
    problems.push("exact_customs_calculation_missing");
  const specificationRejection =
    catalogRequiredSpecificationRejectionReason(offer);
  if (specificationRejection)
    problems.push(`required_specification_${specificationRejection}`);
  const publicPriority = catalogPublicPriority(offer);
  if (!publicPriority.eligible)
    problems.push(`public_${publicPriority.reason}`);
  return { problems: [...new Set(problems)], states };
}

const payload = JSON.parse(await fs.readFile(input, "utf8"));
const offers = Array.isArray(payload?.offers) ? payload.offers : [];
const sourceReports = Array.isArray(payload?.report?.sources)
  ? payload.report.sources
  : [];
const runProblems = [];
if (payload?.market !== expectedMarket)
  runProblems.push("payload_market_mismatch");
if (payload?.report?.writes !== false)
  runProblems.push("no_write_attestation_missing");
if (payload?.report?.strictPublicReady !== true)
  runProblems.push("strict_mode_report_missing");
if (!offers.length) runProblems.push("zero_exact_public_ready_offers");
for (const sourceId of expectedSources) {
  if (!sourceReports.some((row) => row?.sourceId === sourceId))
    runProblems.push(`source_report_missing:${sourceId}`);
}

const ids = new Set();
const invalid = [];
let invalidCount = 0;
let duplicateIdCount = 0;
const fieldCounts = Object.fromEntries(
  SPECIFICATION_AUDIT_FIELDS.map((field) => [
    field,
    { exact: 0, ambiguous: 0, conflict: 0, missing: 0, not_applicable: 0 },
  ]),
);
const perSource = Object.fromEntries(
  expectedSources.map((sourceId) => [sourceId, 0]),
);
for (const offer of offers) {
  if (ids.has(offer?.id)) duplicateIdCount++;
  ids.add(offer?.id);
  perSource[offer?.sourceId] = Number(perSource[offer?.sourceId] || 0) + 1;
  const checked = offerProblems(offer);
  for (const [field, result] of Object.entries(checked.states))
    fieldCounts[field][result.state]++;
  if (checked.problems.length) {
    invalidCount++;
    if (invalid.length < sampleLimit) {
      invalid.push({
        id: offer?.id || null,
        sourceId: offer?.sourceId || null,
        sourceOfferId: offer?.sourceOfferId || null,
        make: offer?.make || null,
        model: offer?.model || null,
        year: offer?.year || null,
        problems: checked.problems,
      });
    }
  }
}
if (duplicateIdCount)
  runProblems.push(`duplicate_offer_ids:${duplicateIdCount}`);
if (invalidCount) runProblems.push(`invalid_offers:${invalidCount}`);

const report = {
  version: 1,
  mode: "four_market_strict_exact_no_write_audit",
  checkedAt: new Date().toISOString(),
  writes: false,
  input,
  expectedMarket,
  expectedSources,
  minimumImages,
  count: offers.length,
  perSource,
  fieldCounts,
  collector: payload?.report || null,
  invalidCount,
  invalid,
  problems: [...new Set(runProblems)],
  passed: runProblems.length === 0,
};

await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exit(1);
