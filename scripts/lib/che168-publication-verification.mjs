import {sourceCollectionComplete} from './catalog-refresh-outcome.mjs';
export function verifyChe168Publication({publication,outcome,manifest,checkpoint,runId}) {
 if (publication?.market!=='china' || publication.published!==true || publication.publicationError
   || !publication.generationId || publication.generationId!==manifest?.generationId
   || Number(publication.publishedMarketCount)<=0
   || publication.publishedMarketCount!==manifest.markets?.china?.count) throw Error('che168_publication_not_active');
 if (outcome?.market!=='china' || String(outcome.runId)!==String(runId)
   || outcome.publicationStatus!=='published' || outcome.generationId!==publication.generationId) throw Error('che168_publication_outcome_mismatch');
 const source=outcome.sources?.find(row=>row.sourceId==='autohome_used_china_open');
 const intake={provider:'auto_api_che168',market:'china',completed:true,completedAt:outcome.lastCollectionAttempt,sources:outcome.sources};
 if (!Number.isFinite(Date.parse(intake.completedAt)) || !sourceCollectionComplete(intake,source)) throw Error('che168_publication_source_incomplete');
 const saved=checkpoint?.sources?.find(row=>row.sourceId===source.sourceId);
 if (checkpoint?.version!==1 || checkpoint.market!=='china' || checkpoint.generationId!==publication.generationId
   || saved?.provider!==source.provider || saved.cursor!==source.cursor || saved.stopReason!=='source_finished'
   || saved.snapshotBinding!==source.snapshotBinding || JSON.stringify(saved.replica)!==JSON.stringify(source.replica)) throw Error('che168_publication_cursor_mismatch');
 return {intake,summary:{runId:String(runId),generationId:manifest.generationId,count:publication.publishedMarketCount,cursor:saved.cursor,verified:true}};
}
