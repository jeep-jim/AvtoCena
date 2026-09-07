export function boundedPilotInteger(value, fallback, maximum) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(maximum, Math.floor(parsed))) : fallback;
}

export function summarizePilotMarket(market) {
  const details = market.details || [];
  const pages = market.pages || [];
  const allowed = details.filter(row => row.yearAllowed);
  // "estimated" describes the commercial profile, not missing vehicle inputs.
  const calculated = row => ['calculated', 'estimated'].includes(row.calculationStatus) && row.totalRub > 0 && !row.error;
  const passing = row => calculated(row) && row.totalRub <= 15_000_000 && row.images >= 5;
  const knownDenominator = pages.length > 0 && pages.every(page => Number.isInteger(page.diagnostics?.listingRows));
  const failures = {};
  for (const row of details) {
    if (calculated(row)) continue;
    const reason = row.error || row.calculationStatus || 'no_calculation';
    failures[reason] = (failures[reason] || 0) + 1;
  }
  return {
    pages: pages.length,
    sourceListingRows: knownDenominator ? pages.reduce((sum, page) => sum + page.diagnostics.listingRows, 0) : null,
    adapterRejectedRows: knownDenominator ? pages.reduce((sum, page) => sum + page.diagnostics.rejectedRows, 0) : null,
    adapterUnexaminedRows: knownDenominator ? pages.reduce((sum, page) => sum + (page.diagnostics.unexaminedRows || 0), 0) : null,
    returnedRows: market.listingRows || 0,
    duplicateRows: market.duplicates || 0,
    normalizationRejected: market.normalizationRejected || 0,
    uniqueNormalizedRows: market.normalizedRows || 0,
    unexaminedRows: Math.max(0, (market.normalizedRows || 0) - details.length),
    examined: details.length,
    calculated: details.filter(calculated).length,
    allowedYearExamined: allowed.length,
    allowedYearCalculated: allowed.filter(calculated).length,
    passingAllFilters: allowed.filter(passing).length,
    failures,
    limitation: 'Source-order bounded sample. Adapter rejections, duplicates, unexamined rows and year exclusions are separate. This is not the acceptance ratio of a full fresh inventory.',
  };
}
