import {MARKET_REFRESH_ANCHOR,MARKET_POLICIES,marketRefreshDue} from '../catalog-next/market-policy.mjs';
// The common entrypoint delegates to each market's documented policy. Adding
// Japan's weekly cadence does not enable a supplier job or grant DUMP rights.
export const CATALOG_REFRESH_ANCHOR = MARKET_REFRESH_ANCHOR;
export function catalogRefreshDue(now = new Date(), market = 'green') {
  return Object.hasOwn(MARKET_POLICIES,market)&&marketRefreshDue(now,market);
}
