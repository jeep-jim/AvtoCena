export function proAuctionsSchedule(state, now = Date.now(), intervalDays = 14) {
  if (!state) return {due:true, resume:false, reason:'first_collection'};
  const started = Date.parse(state.startedAt || '');
  if (!Number.isFinite(started)) throw Error('invalid_collection_started_at');
  if (now - started >= intervalDays * 86400000) return {due:true,resume:false,reason:'refresh_interval'};
  if (state.complete && !state.published) return {due:true,resume:true,reason:'retry_publication'};
  if (!state.complete) return {due:true,resume:true,reason:'resume_checkpoint'};
  return {due:false,resume:false,reason:'fresh_completed_collection'};
}
