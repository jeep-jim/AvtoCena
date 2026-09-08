// Collection is separate from publication: incomplete records are retained.
export async function collectSourcePage(state, options) {
  const { snapshot, writeObservation, checkpoint, deadline, maxRows, maxPages, minYear } = options;
  if (state.done || Date.now() >= deadline) return;
  if (state.pages >= maxPages || state.seen.size >= maxRows) { state.done = true; state.stopReason = 'budget'; return; }
  const cursorKey = JSON.stringify(state.cursor ?? null);
  if (state.cursors.has(cursorKey)) { state.done = true; state.stopReason = 'cursor_loop'; return; }
  let page;
  try { page = await state.source.fetchPage(state.cursor); }
  catch (error) { state.done = true; state.stopReason = 'list_failed'; state.errors.push({stage:'list',message:String(error?.message || error)}); await checkpoint(); return; }
  if (page.health?.blocked) { state.done = true; state.stopReason = 'blocked'; state.health = page.health; await checkpoint(); return; }
  state.cursors.add(cursorKey); state.pages++; state.listingRows += page.items?.length || 0;
  state.health = page.health; state.diagnostics = page.diagnostics;
  let pageComplete = true;
  for (const raw of page.items || []) {
    if (Date.now() >= deadline || state.seen.size >= maxRows) { pageComplete = false; break; }
    let offer;
    try { offer = state.source.normalizeOffer(raw); } catch { state.normalizationFailures++; continue; }
    if (!offer?.id || offer.sourceId !== state.sourceId || offer.market !== options.market) { state.normalizationFailures++; continue; }
    if (state.seen.has(offer.id)) { state.duplicates++; continue; }
    if (Number.isFinite(offer.year) && offer.year < minYear) { state.outsideAge++; continue; }
    if (['withdrawn','deleted','inactive'].includes(offer.status)) { state.withdrawn++; continue; }
    state.seen.add(offer.id);
    await writeObservation(snapshot(offer,'listing'));
    state.detailAttempts++;
    try {
      const images = await state.source.fetchImages(offer);
      if (images?.length) offer.images = images;
      await writeObservation(snapshot(offer,'detail'));
      state.withImages += Boolean(offer.images?.length);
      const groups = offer.operational?.sourceSpecifications?.groups;
      state.withNamedTables += Boolean(groups?.length);
      state.namedFields += (groups || []).reduce((sum, group) => sum + group.items.length, 0);
    } catch (error) {
      const message = String(error?.message || error);
      if (state.errors.length < 30) state.errors.push({stage:'detail',offerId:offer.id,message});
      if (error?.blocked || /(?:http[_: ](?:401|403|429)|bot.?challenge|captcha)/i.test(message)) {
        state.done = true; state.stopReason = 'blocked_detail'; pageComplete = false; break;
      }
    }
  }
  if (pageComplete) {
    state.cursor = page.nextCursor ?? null;
    if (!state.cursor) { state.done = true; state.stopReason = 'source_finished'; }
  } else if (!state.done) { state.done = true; state.stopReason = 'budget_mid_page'; }
  await checkpoint();
}
export function intakeState(source, required) {
  return {source,sourceId:required.sourceId,sourceUrl:required.canonicalUrl,role:required.role,cursor:null,
    seen:new Set(),cursors:new Set(),pages:0,listingRows:0,duplicates:0,normalizationFailures:0,outsideAge:0,withdrawn:0,
    detailAttempts:0,withImages:0,withNamedTables:0,namedFields:0,errors:[],done:!source,stopReason:source?'running':'adapter_missing'};
}
export function intakeSummary(state) {
  const {source,seen,cursors,...rest} = state;
  return {...rest,observations:seen.size};
}
