import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const INPUT_PATH = process.env.CATALOG_SOURCE_TCV_JAPAN_STRICT_INPUT || 'catalog-source-tcv-japan-qualification-v1.json';
const OUTPUT_PATH = process.env.CATALOG_SOURCE_TCV_JAPAN_STRICT_OUTPUT || 'catalog-source-tcv-japan-strict-review-v1.json';

const ACCEPTABLE = new Set(['exact', 'not_applicable']);

function reviewMatrix(matrix) {
  if (!matrix?.fields) return null;
  const fields = { ...matrix.fields };
  const observedDetailPowerTokens = Array.isArray(matrix.detailPower) ? matrix.detailPower : [];
  const observedListPowerTokens = Array.isArray(matrix.listPower) ? matrix.listPower : [];

  // Qualification v1 intentionally captured bare HP/PS/kW tokens from the offer-local
  // text, but did not preserve proof that the token came from a structured/named power
  // field. The project exact contract forbids promoting free text to exact power.
  // Therefore every v1 power token is fail-closed here until label provenance exists.
  fields.power = 'missing_or_ambiguous';

  const required = Object.keys(fields);
  const deficits = required.filter((field) => !ACCEPTABLE.has(fields[field]));
  return {
    ...matrix,
    fields,
    exactReady: deficits.length === 0,
    deficits,
    powerEvidenceStatus: 'unstructured_token_not_exact',
    observedDetailPowerTokens,
    observedListPowerTokens,
    acceptedStructuredPowerTokens: [],
  };
}

export function buildStrictTcvReview(input) {
  if (!input || input.sourceId !== 'tcv_japan_candidate') throw new Error('unexpected TCV qualification input');
  for (const key of [
    'productionWrites',
    'classificationMutations',
    'publishAllowedMutations',
    'objectStorageWrites',
    'catalogGenerationWrites',
    'rawBodiesStored',
    'guessedRoutes',
    'sourcePublishAllowed',
  ]) {
    if (input[key] !== false) throw new Error(`${key} must be false in input`);
  }

  const samples = (input.samples || []).map((sample) => {
    const matrix = reviewMatrix(sample.matrix);
    return {
      ...sample,
      exactReady: sample.stableReachable === true && matrix?.exactReady === true,
      matrix,
    };
  });

  const stableReachable = samples.filter((row) => row.stableReachable).length;
  const exactReady = samples.filter((row) => row.exactReady).length;
  const identityPriceStable = samples.filter((row) => row.stableReachable && row.matrix?.fields?.identity === 'exact' && row.matrix?.fields?.price === 'exact').length;
  const powerMissing = samples.filter((row) => row.stableReachable && row.matrix?.fields?.power === 'missing_or_ambiguous').length;
  const unstructuredPowerRejected = samples.filter((row) => row.matrix?.observedDetailPowerTokens?.length > 0 || row.matrix?.observedListPowerTokens?.length > 0).length;

  let sourceVerdict = 'research_pending';
  if ((input.summary?.candidateCount || 0) === 0) sourceVerdict = input.sourceVerdict || 'no_source_declared_card_candidates';
  else if (exactReady >= 2) sourceVerdict = 'exact_catalog_signal_requires_manual_review';
  else if (stableReachable >= 2 && identityPriceStable >= 2) sourceVerdict = 'lead_only_signal';
  else if (stableReachable > 0) sourceVerdict = 'partial_detail_signal';
  else sourceVerdict = input.sourceVerdict || 'detail_not_repeatably_reachable';

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    inputGeneratedAt: input.generatedAt || null,
    sourceId: input.sourceId,
    sourceUrl: input.sourceUrl,
    listUrl: input.listUrl,
    productionWrites: false,
    classificationMutations: false,
    publishAllowedMutations: false,
    objectStorageWrites: false,
    catalogGenerationWrites: false,
    rawBodiesStored: false,
    guessedRoutes: false,
    sourcePublishAllowed: false,
    reviewBasis: 'Project exact contract rejects bare/free-text HP/PS/kW tokens unless structured/named power-field provenance is preserved. Qualification v1 did not preserve such provenance, so all v1 power tokens remain non-exact.',
    inputSourceVerdict: input.sourceVerdict || null,
    sourceVerdict,
    robots: input.robots || null,
    list: input.list || null,
    samples,
    summary: {
      candidateCount: input.summary?.candidateCount || 0,
      sampled: samples.length,
      stableReachable,
      exactReady,
      identityPriceStable,
      powerMissing,
      unstructuredPowerRejected,
    },
  };
}

async function run() {
  const input = JSON.parse(await fs.readFile(INPUT_PATH, 'utf8'));
  const output = buildStrictTcvReview(input);
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  return output;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  run().then((result) => {
    console.log(JSON.stringify({ sourceId: result.sourceId, inputSourceVerdict: result.inputSourceVerdict, sourceVerdict: result.sourceVerdict, summary: result.summary }, null, 2));
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
