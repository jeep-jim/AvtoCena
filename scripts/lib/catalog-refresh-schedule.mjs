// Midnight in UTC+7, with continuous day intervals across month boundaries.
export const CATALOG_REFRESH_ANCHOR = '2026-09-17T17:00:00Z';
const intervalDays = {china: 1, korea: 2, uae: 2, georgia: 2, green: 3, europe: 3};
export function catalogRefreshDue(now = new Date(), market = 'green') {
  const elapsed = now.getTime() - Date.parse(CATALOG_REFRESH_ANCHOR);
  return Number.isFinite(elapsed) && elapsed >= 0 && Object.hasOwn(intervalDays, market)
    && Math.floor(elapsed / 86400000) % intervalDays[market] === 0;
}
