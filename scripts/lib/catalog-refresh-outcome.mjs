import {publishedIntakeCheckpoint} from './catalog-intake-checkpoint.mjs';
const finished = new Set(['source_finished', 'source_cycle_finished']);
export function sourceCollectionComplete(intake, source) {
 if (source?.provider === 'auto_api_che168') {
  if (intake?.provider !== 'auto_api_che168' || intake.market !== 'china' || intake.completed !== true || intake.failure
    || source.sourceId !== 'autohome_used_china_open' || source.stopReason !== 'source_finished'
    || source.completeInventory !== true || !(source.observations > 0)
    || !Number.isSafeInteger(source.initialCursor) || source.initialCursor < 0
    || !Number.isSafeInteger(source.cursor) || source.cursor < source.initialCursor || !source.snapshotBinding) return false;
  try {
   publishedIntakeCheckpoint({...intake,sources:[source]}, {published:true,generationId:'validation-only',market:'china'});
   return true;
  } catch { return false; }
 }
 return finished.has(source?.stopReason) && !source.initialCursor;
}
export function collectionComplete(intake, requiredSourceIds) {
 const required = requiredSourceIds || intake?.sources?.map(source=>source.sourceId) || [];
 return Boolean(Number.isFinite(Date.parse(intake?.completedAt)) && required.length
  && !(intake.partialSources || []).some(source=>required.includes(typeof source==='string'?source:source.sourceId))
  && required.every(id=>{
   const rows=(intake.sources || []).filter(source=>source.sourceId===id);
   return rows.length===1 && sourceCollectionComplete(intake,rows[0]);
  }));
}
/** Attempts, source coverage and committed publication are separate facts. */
export function refreshOutcome({market,previous={},intake,publication,now,runId,requiredSourceIds}) {
 const complete=collectionComplete(intake,requiredSourceIds);
 const required=requiredSourceIds || intake?.sources?.map(source=>source.sourceId) || [];
 const incomplete=(intake?.sources || []).filter(source=>!sourceCollectionComplete(intake,source));
 const published=publication?.published===true;
 const previousComplete=previous.version>=2 || previous.qualityStatus==='configured_routes_finished';
 return {...previous,version:2,market,lastAttemptAt:now,runId,
  lastPublicationSuccess:published?(publication.publishedAt||now):(previous.lastPublicationSuccess||null),
  lastCollectionSuccess:complete?intake.completedAt:(previousComplete?previous.lastCollectionSuccess||null:null),
  lastCollectionAttempt:intake?.completedAt||intake?.updatedAt||null,
  sourceObservedAt:intake?.updatedAt||null,
  publicationStatus:published?'published':'failed',
  publicationError:publication?.publicationError||(!publication?'publication_report_missing':null),
  collectionComplete:complete,qualityStatus:complete?'configured_routes_finished':intake?'partial':'missing',
  sources:(intake?.sources||[]).map(source=>({...source,required:required.includes(source.sourceId)})),
  partialSources:incomplete.filter(s=>required.includes(s.sourceId)).map(s=>({sourceId:s.sourceId,reason:s.stopReason})),
  supplementalPartialSources:incomplete.filter(s=>!required.includes(s.sourceId)).map(s=>({sourceId:s.sourceId,reason:s.stopReason})),
  generationId:published?publication.generationId:previous.generationId||null,
  powerMix:published?publication.powerMix?.[market]||null:previous.powerMix||null,
  sourceShare:published?publication.sourceShare?.[market]||null:previous.sourceShare||null,
  publishedCount:publication?.publishedMarketCount??previous.publishedCount??null};
}
