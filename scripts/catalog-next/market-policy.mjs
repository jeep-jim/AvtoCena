import assert from 'node:assert/strict';

// Owner's current rules, 24 November 2026. Unconfirmed year bounds remain
// explicit; they must not silently inherit another market's restriction.
export const MARKET_POLICY_VERSION = 1;
export const MARKET_TIMEZONE = 'Asia/Krasnoyarsk';
export const MARKET_REFRESH_ANCHOR = '2026-09-17T17:00:00Z';
const definitions = {
  china: {provider:'auto_api', source:'che168', intervalDays:1, minimumYear:2014},
  japan: {provider:'aj_system', source:'japan', intervalDays:7, minimumYear:2008},
  korea: {provider:'auto_api', source:'encar', intervalDays:2, minimumYear:2014},
  europe: {provider:'mobile_de', source:'mobile_de', intervalDays:3, minimumYear:null},
  uae: {provider:'auto_api', source:'dubicars', intervalDays:2, minimumYear:null},
  georgia: {provider:'existing_configuration', source:'existing_configuration', intervalDays:2, minimumYear:null},
  green: {provider:'akebono', source:'green_corner', intervalDays:3, minimumYear:null},
};
export const MARKET_POLICIES = Object.freeze(Object.fromEntries(Object.entries(definitions)
  .map(([market, value]) => [market,Object.freeze({version:MARKET_POLICY_VERSION,market,timezone:MARKET_TIMEZONE,...value})])));

export function marketPolicy(market) {
  assert(Object.hasOwn(MARKET_POLICIES,market),'market_policy_unknown');
  return MARKET_POLICIES[market];
}

/** A daily scheduler checks one market's own continuous cadence. This only
 * returns a due decision; it grants neither supplier access nor publication. */
export function marketRefreshDue(now=new Date(),market) {
  const policy=marketPolicy(market),elapsed=now.getTime()-Date.parse(MARKET_REFRESH_ANCHOR);
  return Number.isFinite(elapsed)&&elapsed>=0&&Math.floor(elapsed/86400000)%policy.intervalDays===0;
}
