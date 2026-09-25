const finished = new Set(['source_finished', 'source_cycle_finished']);
export function collectionComplete(intake) {
 return Boolean(intake?.completedAt && intake.sources?.length && !intake.partialSources?.length
  && intake.sources.every(source => finished.has(source.stopReason)));
}
/** Attempts, source coverage and committed publication are separate facts. */
export function refreshOutcome({market,previous={},intake,publication,now,runId}) {
 const complete=collectionComplete(intake);
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
  sources:intake?.sources||[],partialSources:intake?.sources?.filter(s=>!finished.has(s.stopReason)).map(s=>({sourceId:s.sourceId,reason:s.stopReason}))||[],
  generationId:published?publication.generationId:previous.generationId||null,
  powerMix:published?publication.powerMix?.[market]||null:previous.powerMix||null,
  sourceShare:published?publication.sourceShare?.[market]||null:previous.sourceShare||null,
  publishedCount:publication?.publishedMarketCount??previous.publishedCount??null};
}
