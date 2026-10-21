export function extractCarvectorOffersFromNgState(markup) {
  const source = String(markup || "");
  const encoded = source.match(/<script\b[^>]*\bid=["']ng-state["'][^>]*>([\s\S]*?)<\/script>/i)?.[1] || "";
  if (!encoded) throw new Error("carvector_ng_state_missing");
  const state = JSON.parse(encoded);
  const candidates = Object.values(state).filter((value) => value && typeof value === "object" && !Array.isArray(value))
    .map((value) => value?.b?.data?.result)
    .filter((value) => Array.isArray(value?.offers) && Number.isFinite(Number(value?.total)));
  const result = candidates.sort((left, right) => Number(right.offers.length) - Number(left.offers.length))[0];
  if (!result) {
    const context = state?.INIT_STATE_PROJECT_CONTEXT || {};
    throw new Error(`carvector_ng_state_offers_missing:rateLimited=${context.rateLimited === true}:retryAfter=${Number(context.retryAfterSeconds || 0)}`);
  }
  return { total: Number(result.total || 0), offers: result.offers };
}
