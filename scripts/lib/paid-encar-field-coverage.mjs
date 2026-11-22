import {isDeepStrictEqual} from 'node:util';
import {catalogPowerBand} from '../../apps/web/lib/catalog/power-mix.ts';

const POWERTRAIN_KINDS = ['combustion', 'electric', 'series_hybrid', 'other_hybrid', 'unknown'];
const positiveFinite = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const emptyCounts = () => ({rows:0, withPowerHp:0, withEngineCc:0, withFuel:0,
  withUtilizationPowerKw:0, hpPresentButPowerBandUnknown:0});
const COUNT_FIELDS = Object.keys(emptyCounts());
const emptyCoverage = () => ({...emptyCounts(), byPowertrainKind:Object.fromEntries(
  POWERTRAIN_KINDS.map(kind => [kind, emptyCounts()]))});

/** Presence in already prepared rows, not source verification or price eligibility.
 * Fixed-size counters only: never read identities, operational metadata or raw data. */
export function paidEncarTechnicalCoverage(rows) {
  if (!Array.isArray(rows)) throw new TypeError('paid_encar_coverage_rows_required');
  const result = emptyCoverage();
  for (const value of rows) {
    const row = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const powerHp = positiveFinite(row.powerHp) ? row.powerHp : undefined;
    const engineCc = positiveFinite(row.engineCc) ? row.engineCc : undefined;
    const utilizationPowerKw = positiveFinite(row.utilizationPowerKw) ? row.utilizationPowerKw : undefined;
    const fuel = typeof row.fuel === 'string' ? row.fuel : undefined;
    const powertrainKind = typeof row.powertrainKind === 'string' ? row.powertrainKind : undefined;
    const bucket = POWERTRAIN_KINDS.includes(powertrainKind) ? powertrainKind : 'unknown';
    // Reuse the actual band policy, with invalid numeric values excluded rather
    // than coerced. System hp can be present while certified power is unknown.
    const hpPresentButPowerBandUnknown = powerHp !== undefined
      && catalogPowerBand({powerHp, utilizationPowerKw, fuel, powertrainKind}) === 'unknown';
    for (const counts of [result, result.byPowertrainKind[bucket]]) {
      counts.rows++;
      counts.withPowerHp += Number(powerHp !== undefined);
      counts.withEngineCc += Number(engineCc !== undefined);
      counts.withFuel += Number(Boolean(fuel?.trim()));
      counts.withUtilizationPowerKw += Number(utilizationPowerKw !== undefined);
      counts.hpPresentButPowerBandUnknown += Number(hpPresentButPowerBandUnknown);
    }
  }
  return result;
}

function requireCoverage(condition, reason) {
  if (!condition) throw new Error('paid_encar_coverage_' + reason);
}

/** Fresh manifest-bound storage readback. Retain at most four chunks plus the
 * bounded ID set; identities are checked locally and never enter the result. */
export async function readPaidEncarTechnicalCoverage(storage, expectedManifest) {
  const expected = structuredClone(expectedManifest), market = expected?.markets?.korea;
  requireCoverage(expected?.version === 2 && /^gen_\d+_[a-z0-9-]+$/.test(expected?.generationId || '')
    && Number.isSafeInteger(market?.count) && market.count >= 0 && market.count <= 500000
    && Array.isArray(market.chunks) && market.chunks.length <= 10000
    && (market.count === 0 ? market.chunks.length === 0 : market.chunks.length > 0), 'manifest_invalid');
  const paths = market.chunks.map(chunk => {
    requireCoverage(typeof chunk === 'string', 'chunk_path_invalid');
    const key = /^[a-z0-9-]+$/.test(chunk)
      ? `catalog/generations/${expected.generationId}/offers/korea/${chunk}.json` : chunk;
    // An explicitly listed borrowed immutable chunk is valid; other markets,
    // current aliases, traversal and arbitrary storage paths are never read.
    requireCoverage(/^catalog\/generations\/gen_\d+_[a-z0-9-]+\/offers\/korea\/[a-z0-9-]+\.json$/.test(key), 'chunk_path_invalid');
    return key;
  });
  requireCoverage(new Set(paths).size === paths.length, 'duplicate_chunk');
  const verifyManifest = async () => {
    const actual = await storage.readJson('catalog/manifest.json', null);
    requireCoverage(isDeepStrictEqual(actual, expected), 'manifest_changed');
  };
  await verifyManifest();
  const coverage = emptyCoverage(), ids = new Set();
  for (let offset = 0; offset < paths.length; offset += 4) {
    const chunks = await Promise.all(paths.slice(offset, offset + 4).map(key => storage.readJson(key, null)));
    for (const rows of chunks) {
      requireCoverage(Array.isArray(rows) && rows.length > 0 && rows.length <= 5000, 'chunk_invalid');
      for (const row of rows) {
        requireCoverage(row !== null && typeof row === 'object' && !Array.isArray(row)
          && row.market === 'korea' && typeof row.id === 'string' && row.id.length > 0
          && row.id.length <= 256 && row.id === row.id.trim(), 'row_invalid');
        requireCoverage(!ids.has(row.id), 'duplicate_id');
        ids.add(row.id);
      }
      const part = paidEncarTechnicalCoverage(rows);
      for (const field of COUNT_FIELDS) coverage[field] += part[field];
      for (const kind of POWERTRAIN_KINDS) {
        for (const field of COUNT_FIELDS) coverage.byPowertrainKind[kind][field] += part.byPowertrainKind[kind][field];
      }
      requireCoverage(coverage.rows <= market.count, 'count_mismatch');
    }
  }
  requireCoverage(coverage.rows === market.count && ids.size === market.count, 'count_mismatch');
  await verifyManifest();
  return {generationId:expected.generationId, coverage};
}
