/** Stable SSR/browser count text. NBSP groups thousands without splitting the number. */
export function formatCatalogCount(count: number): string {
  if (!Number.isSafeInteger(count) || count < 0) return "—";
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
}

/** Only market-by-market exact counts can support a partial total in the UI. */
export function confirmedMarketMinimum(data: {
  ok?: boolean; total?: unknown; countIncomplete?: boolean; marketCounts?: Record<string, unknown>; missingMarkets?: unknown;
} | null): string | undefined {
  if (data?.ok !== true || !data.countIncomplete || !Array.isArray(data.missingMarkets) || !data.missingMarkets.length) return;
  if (typeof data.total !== 'number' || !Number.isSafeInteger(data.total) || data.total <= 0) return;
  const entries = Object.entries(data.marketCounts ?? {});
  let confirmed = 0;
  for (const [market, count] of entries) {
    if (data.missingMarkets.includes(market) || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return;
    confirmed += count;
  }
  if (confirmed === data.total) return `Нашли не менее ${formatCatalogCount(confirmed)} 🚗`;
}
