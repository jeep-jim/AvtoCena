import {sourceTransportFailure} from './source-transport-failure.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {assertRawHandoff, assertDurableIntakeArchive} from './catalog-raw-provenance.mjs';

// At most 500 observation revisions (normally 250 cars) per raw shard.
export function observationShardWriter(directory, sourceId) {
  if (!/^[a-z0-9_-]+$/i.test(sourceId)) throw Error('invalid_intake_source');
  let count = 0, part=0, partRows=0, partBytes=0, filename='';
  let queue = Promise.resolve();
  return row => (queue = queue.then(async () => {
    const line=JSON.stringify(row)+'\n';
    const size=Buffer.byteLength(line);
    if(!partRows||partRows>=500||partBytes+size>8*1024*1024){
      part++;partRows=0;partBytes=0;
      filename=path.join(directory,`${sourceId}-${String(part).padStart(6,'0')}.jsonl`);
      await fs.writeFile(filename,'',{flag:'wx'});
    }
    await fs.appendFile(filename,line);partRows++;partBytes+=size;
    count++;
  }));
}

export function restoreIntakeCursor(state, saved, now = Date.now()) {
  if (saved?.version !== 1 || saved.market !== state.source.market) return;
  const age = now - Date.parse(saved.updatedAt || '');
  if (!Number.isFinite(age) || age < 0 || age > 14 * 86400000) return;
  const row = saved.sources?.find(row => row.sourceId === state.sourceId);
  // Resume published budget slices or proven transport interruptions on the
  // same failed cursor. Never skip an access denial, parser failure or finished scan.
  if (row && (['budget', 'time_budget', 'budget_mid_page','disk_budget'].includes(row.stopReason) || row.stopReason === 'list_failed' && row.retryableTransportFailure === true) && typeof row.cursor === 'string' && row.cursor.length) {
    state.cursor = row.cursor;
    state.initialCursor = row.cursor;
  }
}

export function publishedIntakeCheckpoint(intake, publication) {
  if (intake?.mode === 'saved_snapshot_technical_repair' || intake?.sources?.some(row => row.syncMode === 'technical_repair')) throw Error('technical_repair_must_not_advance_cursor');
  if (!publication?.published || !publication.generationId || publication.market !== intake?.market) {
    throw Error('intake_cursor_requires_successful_publication');
  }
  if (!intake.completedAt || !Array.isArray(intake.sources)) throw Error('intake_incomplete_report');
  if (['auto_api_che168','auto_api_dubicars'].includes(intake.provider) && (intake.completed!==true || intake.failure
    || intake.sources.some(row=>['auto_api_che168','auto_api_dubicars'].includes(row.provider) && (row.rejectedIdentity!==0 || !Number.isSafeInteger(row.cursor) || row.cursor<0)))) throw Error('auto_api_incomplete_cursor_not_committable');
  if(intake.sources.some(row=>row.snapshotBinding && (!/^[a-f0-9]{64}$/.test(row.snapshotBinding)
    ||row.completeInventory!==true||row.replica?.binding!==row.snapshotBinding||row.replica?.cursor!==row.cursor
    ||!/^catalog\/provider-replicas\/che168\/[a-f0-9-]{36}$/.test(row.replica?.key)||!/^[a-f0-9]{64}$/.test(row.replica?.sha256))))throw Error('auto_api_replica_cursor_not_committable');
  const pins=intake.rawStoragePins||[];
  if(!Array.isArray(pins)||pins.length>64)throw Error('raw_intake_pin_limit');
  pins.forEach(assertRawHandoff);
  const archive = intake.durableIntakeArchive ? assertDurableIntakeArchive(intake.durableIntakeArchive, intake.market) : null;
  const archiveDependencies = intake.rawArchiveDependencies || [];
  if(!Array.isArray(archiveDependencies)||archiveDependencies.length>64)throw Error('raw_intake_dependency_limit');
  const dependencies = archiveDependencies.map(row=>assertDurableIntakeArchive(row,intake.market));
  if(intake.provider==='auto_api_encar' && (intake.completed!==true || !/^\d{1,20}$/.test(intake.snapshotRun||'')
    || !/^[1-9]\d{0,5}$/.test(intake.snapshotAttempt||'') || intake.sources.some(row=>row.provider!=='auto_api_encar')))
    throw Error('raw_encar_cursor_identity');
  return { version: 1, market: intake.market, updatedAt: intake.completedAt,
    generationId: publication.generationId,
    ...(pins.length?{rawStoragePins:pins}:{}),
    ...(archive?{durableIntakeArchive:archive}:{}),
    ...(dependencies.length?{rawArchiveDependencies:dependencies}:{}),
    ...(intake.provider==='auto_api_encar'?{provider:intake.provider,snapshotRun:intake.snapshotRun,snapshotAttempt:intake.snapshotAttempt}:{}),
    sources: intake.sources.map(row => ({ sourceId: row.sourceId,
      ...(row.provider==='auto_api_encar'?{provider:row.provider,snapshotRun:intake.snapshotRun,snapshotAttempt:intake.snapshotAttempt}:{}),
      ...(['auto_api_che168','auto_api_dubicars'].includes(row.provider)?{provider:row.provider,snapshotStartedAt:row.snapshotStartedAt,yearFrom:row.yearFrom,
        ...(row.snapshotBinding?{snapshotBinding:row.snapshotBinding,replica:row.replica,
          ...(row.workingJournal?{workingJournal:row.workingJournal}:{}),...(row.baseReplica?{baseReplica:row.baseReplica}:{})}:{} )}:{}),
      cursor: row.cursor ?? null, stopReason: row.stopReason,
      retryableTransportFailure: row.stopReason === "list_failed" && !!row.errors?.length && row.errors.every(error=>error.stage === "list" && sourceTransportFailure(error.message)) })) };
}
