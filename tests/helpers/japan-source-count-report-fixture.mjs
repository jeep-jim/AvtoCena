/** Synthetic controller evidence only; production proof is produced by the browser. */
export function sourceCountReport(checkedAt = '2026-11-28T12:00:00.000Z', sourceScopeComplete = true) {
  const observedAt = new Date(Date.parse(checkedAt) - 60_000).toISOString();
  const requestedQueryHash = '1'.repeat(64), sourceQueryHash = '2'.repeat(64), evidenceEpoch = '3'.repeat(64);
  const cursor = 'j1.2.0.2.' + '4'.repeat(64) + '.-';
  return {
    countAcceptance: 'japan-source-count-v1', checkedAt,
    japanSourceCountRequired: true, japanSourceCountPassed: true,
    japanModelCoverageRequired: true, japanModelCoveragePassed: true,
    japanExactCountRequired: false, japanExactCountPassed: null,
    checks: {
      modelCoverage: {
        sourcePairs: 94, accessiblePairs: 94, coverageContract: 'directory-and-visible-cards-v1',
        optionPairs: 95, optionPairsSha256: 'b'.repeat(64), cardBackedExtraPairs: 1,
        cardBackedExtraPairsSha256: 'c'.repeat(64), visibleCardPairs: 3, visibleCardPairsSha256: 'd'.repeat(64),
        cardProvenanceSha256: 'e'.repeat(64), uiEqualsDirectory: false, allOptionsSourceBacked: true,
        allSourceModelsAccessible: true, noForeignModels: true, sourceMatchesUi: true,
        typedBase: 'A4', typedFamilyNotNarrowed: true, pairsSha256: 'a'.repeat(64),
        modelExpansions: 1, sourceFamilyModels: 3, make: 'AUDI',
        directory: {status: 200, stale: false, sourcePairs: 94, pairsSha256: 'a'.repeat(64), browserMatchesApi: true},
        selection: {shown: 24, observedSourceNamesOnly: true}, countHonest: true, fullPage: true,
        explicitApiReads: 3, liveExhaustiveScan: false, pageErrors: 0,
      },
      sourceCount: {
        contract: 'japan-source-count-browser-v1',
        summary: {total: 1234, stale: false, observedAt, upperBound: true, precision: 'source-upper-bound',
          selectionScope: 'source-candidates', sourceScopeComplete,
          sourceCountProof: {version: 1, kind: 'japan-source-count', predicateVersion: 'japan-source-candidates-v1',
            requestedQueryHash, sourceQueryHash, evidenceEpoch, sourceTotal: 1234, sourceObservedAt: observedAt,
            sourceScopeComplete, directoryComplete: true}},
        queryHashVerified: true, independentCount: true, admittedTotal: null, positiveAdmittedCensusClaimed: false,
        ui: {status: sourceScopeComplete ? 'bounded' : 'source', sourceTotal: 1234, requestedQueryHash,
          observedAt, loadedCount: 24, label: (sourceScopeComplete ? 'Найдено до ' : 'В источнике: ') + '1\u00a0234'},
        pagination: {sameFilter: true, cursorBeforeCount: cursor, cursorAfterCount: cursor, continuationCursor: cursor,
          continuationFollowed: true, loadedBefore: 24, loadedAfter: 48, duplicateIds: 0, freshSourcePages: true},
        liveExhaustiveScan: false, pageErrors: 0,
      },
    },
  };
}
