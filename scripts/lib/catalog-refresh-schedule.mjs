// A continuous 72-hour calendar, including month/year boundaries. The daily
// cron is only a wake-up; collection runs on one day out of three at 18:00 UTC.
export const CATALOG_REFRESH_ANCHOR = '2026-09-17T18:00:00Z';
export function catalogRefreshDue(now = new Date()) {
  const elapsed = now.getTime() - Date.parse(CATALOG_REFRESH_ANCHOR);
  return Number.isFinite(elapsed) && elapsed >= 0 && Math.floor(elapsed / 86400000) % 3 === 0;
}
