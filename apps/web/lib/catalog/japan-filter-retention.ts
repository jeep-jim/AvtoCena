export const JAPAN_FILTER_KEYS = ['chassis', 'frameNumber', 'lotNumber', 'auctionGrade', 'salePeriod'] as const;
type JapanFilterKey = typeof JAPAN_FILTER_KEYS[number];
type JapanFilterDraft = Record<JapanFilterKey, string> & {market:string;stock:string};
export const savedJapanFilterKey = (key:JapanFilterKey) => `savedJapan${key[0].toUpperCase()}${key.slice(1)}`;
export const JAPAN_FILTER_QUERY_KEYS = [...JAPAN_FILTER_KEYS, ...JAPAN_FILTER_KEYS.map(savedJapanFilterKey)];
export function japanFiltersApply(draft:{market:string;stock:string}) {
  return draft.market === 'japan' && draft.stock !== 'green';
}
export function rememberedJapanFilter(initial:Record<string,string>, key:JapanFilterKey) {
  return initial[key] || initial[savedJapanFilterKey(key)] || '';
}
// Keep unavailable choices in the URL so reload, sharing and Back retain them.
// Only the Japan auction catalogue receives them as active search constraints.
export function appendJapanFilterQuery(params:URLSearchParams, draft:JapanFilterDraft) {
  const active = japanFiltersApply(draft);
  for (const key of JAPAN_FILTER_KEYS) {
    const value = String(draft[key] || '').replace(/\s+/g, ' ').trim();
    params.delete(key);
    params.delete(savedJapanFilterKey(key));
    if (value) params.set(active ? key : savedJapanFilterKey(key), value);
  }
}
