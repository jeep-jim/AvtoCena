import assert from 'node:assert/strict';
import {rawDigest, rawGenerationKey, intakeRawReferences, assertRawGenerationProvenance,
  RAW_TRACKED_MARKETS, rawReferences, collectPaidReportReferences, stageRawGenerationProvenance,
  assertRawHandoff, releaseRawHandoff} from './catalog-raw-provenance.mjs';
import {readIntakeArchiveManifest} from './nonjp-intake-archive.mjs';

function retainSourceDependencies(previous, next) {
  if (!previous) return next;
  if (!next) return previous;
  return {complete: previous.complete === true && next.complete === true,
    producers: [...new Map([...previous.producers, ...next.producers].map(row => [rawDigest(row), row])).values()],
    references: rawReferences([...previous.references, ...next.references]),
    unknownSources: [...new Set([...previous.unknownSources, ...next.unknownSources])]};
}

/** Called by the existing publisher while its import lease is held, before aliases. */
export async function prepareRawPublication({storage, manifest, expectedBaseGenerationId, market, intake, clock = Date.now}) {
  const baseline = await storage.readJson('catalog/manifest.json', null);
  assert.equal(baseline?.generationId || 'empty', expectedBaseGenerationId, 'raw_publication_base_changed');
  const prior = expectedBaseGenerationId === 'empty' ? null : await storage.readJson(rawGenerationKey(expectedBaseGenerationId), null);
  const marketSources = {};
  if (prior !== null) {
    assertRawGenerationProvenance(prior, baseline, {requireComplete: false});
    for (const name of RAW_TRACKED_MARKETS) marketSources[name] = prior.markets[name];
  }
  // The normal publisher merges fresh and retained fields/rows. A new archive
  // alone cannot erase the origin of borrowed data or make historic unknowns
  // complete. A future proven replacement/compaction may retire dependencies.
  if (baseline?.markets?.[market]?.count > 0 && !marketSources[market]) marketSources[market] = {
    complete: false, producers: [], references: [], unknownSources: ['historic_provenance_missing'],
  };
  if (RAW_TRACKED_MARKETS.includes(market) && intake) {
    assert.equal(intake.market, market, 'raw_publication_intake_market');
    if (intake.durableIntakeArchive) await readIntakeArchiveManifest({storage, receipt: intake.durableIntakeArchive});
    if (intake.completed === true || intake.durableIntakeArchive) marketSources[market] = retainSourceDependencies(
      baseline?.markets?.[market]?.count > 0 ? marketSources[market] : null, intakeRawReferences(intake));
  }
  const handoffs = intake?.rawStoragePins || [];
  assert.ok(Array.isArray(handoffs) && handoffs.length <= 64, 'raw_publication_pin_limit');
  handoffs.forEach(assertRawHandoff);
  if (marketSources[market]) marketSources[market].references.push(...handoffs.flatMap(row => row.references));
  const paidReports = await collectPaidReportReferences({storage, manifest});
  const verifyProvenance = await stageRawGenerationProvenance({storage, manifest, marketSources, paidReports});
  return {
    async verify() {
      assert.equal(rawDigest(await storage.readJson('catalog/manifest.json', null)), rawDigest(baseline), 'raw_publication_base_changed');
      await verifyProvenance();
      if (intake?.durableIntakeArchive) await readIntakeArchiveManifest({storage, receipt: intake.durableIntakeArchive});
    },
    async releasePins() {
      const pending = [], closed = [];
      for (const handoff of handoffs) {
        try { await releaseRawHandoff({storage, handoff, manifest, clock}); closed.push(handoff.operationId); }
        catch { pending.push(handoff.operationId); }
      }
      // Publication already succeeded. A failed pin release keeps protection;
      // it must not turn into a catalogue rollback or a false cleanup success.
      return {pinsClosed: closed, cleanupPending: pending, status: pending.length ? 'cleanup_pending' : 'pins_released'};
    },
  };
}
