import {createHash} from 'node:crypto';
import {autoApiChe168RejectionReason,isAutoApiChe168QuarantineReason,AUTO_API_CHE168_SOURCE as sourceId} from '../../apps/web/lib/catalog/auto-api-che168.ts';
import {stableOfferId} from '../../apps/web/lib/catalog/storage.ts';
import {snapshotBinding,readChe168Snapshot} from './che168-snapshot.mjs';
import {consumeChe168Csv} from './che168-csv-stream.mjs';
import {openChe168ReplayJournal} from './che168-replay-journal.mjs';

const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validId=value=>/^\d+$/.test(String(value ?? ''));
const validDate=value=>Number.isFinite(Date.parse(value));
const fail=code=>{throw Error(`auto_api_bulk_audit_${code}`);};
const present=value=>value!==null&&value!==undefined&&String(value).trim()!=='';

// Exactly the two quarantine limits of the production bulk importer. This
// diagnostic reports their result; it cannot change or bypass either limit.
export function che168BulkAuditGate(active,quarantined){
  const share=quarantined/(active+quarantined||1);
  const absoluteLimitExceeded=quarantined>1000;
  const shareLimitExceeded=quarantined>10&&share>0.005;
  return {active,quarantined,share,emptyInventory:active===0,
    absoluteLimitExceeded,shareLimitExceeded,
    quarantineGatePassed:!absoluteLimitExceeded&&!shareLimitExceeded};
}

/** Match the importer's SQLite event comparisons and separate quarantine Map.
 * Only IDs, event numbers and reason codes are retained; no listing payloads. */
export function createChe168BulkAuditState(initialCursor){
  if(!Number.isSafeInteger(initialCursor)||initialCursor<0)fail('invalid_initial_cursor');
  const active=new Map(),quarantine=new Map();
  const csv={validRows:0,quarantinedRows:0,reasons:{missing_model:0,invalid_year:0},
    quarantineFields:{missing_model:{withComplectation:0,withConfiguration:0,withSpecificationId:0,withEmbeddedConfiguration:0},
      invalid_year:{missing:0,presentButInvalid:0,withFirstRegistration:0,valueClasses:{}}}};
  const events={offer:0,price:0,removed:0,quarantine:0};
  const put=(id,event)=>{
    if(!active.has(id)||active.get(id)<=event)active.set(id,event);
    // The production importer clears quarantine even for an older observation.
    quarantine.delete(id);
  };
  const remove=(id,event)=>{if(active.has(id)&&active.get(id)<=event)active.delete(id);};
  const summary=()=>({ ...che168BulkAuditGate(active.size,quarantine.size),
    reasons:{missing_model:[...quarantine.values()].filter(r=>r==='missing_model').length,
      invalid_year:[...quarantine.values()].filter(r=>r==='invalid_year').length} });
  return {
    csv,
    events,
    summary,
    addCsvRow(row){
      const reason=autoApiChe168RejectionReason(row),id=String(row?.inner_id);
      if(!reason){csv.validRows++;put(id,initialCursor-1);return;}
      if(!isAutoApiChe168QuarantineReason(reason))fail('identity_review_required');
      csv.quarantinedRows++;csv.reasons[reason]++;
      remove(id,initialCursor-1);quarantine.set(id,reason);
      if(reason==='missing_model'){
        const fields=csv.quarantineFields.missing_model,d=row.data;
        fields.withComplectation+=Number(present(d.complectation));
        fields.withConfiguration+=Number(present(d.configuration));
        fields.withSpecificationId+=Number(validId(d.specid));
        fields.withEmbeddedConfiguration+=Number(!!d.extra?.configuration&&Object.keys(d.extra.configuration).length>0);
      }else{
        const fields=csv.quarantineFields.invalid_year;
        const value=String(row.data.year??'').trim();
        const key=/^\d{1,4}$/.test(value)?value:!value?'empty':'other_format';
        fields.valueClasses[key]=(fields.valueClasses[key]||0)+1;
        fields.missing+=Number(!present(row.data.year));
        fields.presentButInvalid+=Number(present(row.data.year));
        fields.withFirstRegistration+=Number(present(row.data.first_registration));
      }
    },
    async applyJournalEvent(event){
      if(!Number.isSafeInteger(event?.event)||event.event<initialCursor-1||!Object.hasOwn(events,event?.kind))fail('invalid_event');
      if(event.kind==='offer'){
        const offer=event.offer,id=String(offer?.sourceOfferId);
        if(!validId(id)||offer?.sourceId!==sourceId||offer.market!=='china'
          ||offer.id!==stableOfferId(sourceId,id)||offer.operational?.provider!=='auto-api.com'
          ||offer.operational?.detailIdentityVerified!==true||!validDate(event.at))fail('invalid_event');
        put(id,event.event);
      }else{
        if(typeof event.innerId!=='string'||!validId(event.innerId)||!validDate(event.at))fail('invalid_event');
        if(event.kind==='price'){
          if(!active.has(event.innerId)||!Number.isFinite(event.price)||event.price<=0)fail('invalid_price');
          if(active.get(event.innerId)<=event.event)active.set(event.innerId,event.event);
        }else{
          remove(event.innerId,event.event);
          if(event.kind==='quarantine'){
            if(!isAutoApiChe168QuarantineReason(event.reason))fail('invalid_event');
            quarantine.set(event.innerId,event.reason);
          }else quarantine.delete(event.innerId);
        }
      }
      events[event.kind]++;
    },
  };
}

// Bind only reads. The underlying production storage object's mutation methods
// are never passed to snapshot or journal readers.
export function che168BulkAuditReadOnlyStorage(storage){
  return Object.freeze({
    readJson:storage.readJson.bind(storage),
    readJsonWithMeta:storage.readJsonWithMeta.bind(storage),
    getBinary:storage.getBinary.bind(storage),
    writeJson:async()=>fail('write_forbidden'),
  });
}

export async function auditChe168BulkSnapshot({config,storage,yearFrom,expectedCursor,expectedChanges,onProgress=()=>{}}){
  const readStartedAt=new Date().toISOString();
  const binding=snapshotBinding(config),readOnly=che168BulkAuditReadOnlyStorage(storage);
  const [saved,manifest]=await Promise.all([
    readOnly.readJson('catalog/intake-cursors/v1/china.json',null),
    readOnly.readJson('catalog/manifest.json',null),
  ]);
  const previous=saved?.sources?.find(row=>row.sourceId===sourceId);
  // This audit reconstructs the failed FIRST bootstrap, never a later replica.
  if(previous?.snapshotBinding===binding)fail('already_published');
  const initialCursor=config.initialCursor;
  const journalBinding=sha({binding,initialCursor,base:null});
  const artifactRunId=BigInt(`0x${journalBinding.slice(0,14)}`).toString();
  const journalPrefix=`catalog/intake-working/che168-v1/${artifactRunId}`;
  const journalHeadKey=`${journalPrefix}/head.json`;
  const meta=structuredClone(await readOnly.readJsonWithMeta(journalHeadKey,null));
  if(!meta.found)fail('missing_journal');
  if(meta.value?.binding!==journalBinding||meta.value?.initialCursor!==initialCursor
    ||meta.value?.cursor!==expectedCursor||meta.value?.changes!==expectedChanges)fail('unexpected_journal_cursor');
  const state=createChe168BulkAuditState(initialCursor);
  let selected=0;
  const csv=await consumeChe168Csv({chunks:readChe168Snapshot({config,storage:readOnly}),yearFrom,
    onRow:async row=>{state.addCsvRow(row);if(++selected%25000===0)await onProgress({phase:'csv',selectedRows:selected});}});
  const afterCsv=state.summary();
  // Freeze the head from before the full read. Immutable chunks remain valid if
  // another process advances the working journal while this audit is running.
  const pinnedStorage=Object.freeze({
    readJsonWithMeta:async key=>{if(key!==journalHeadKey)fail('unexpected_read');return structuredClone(meta);},
    readJson:async(key,fallback)=>{
      if(!new RegExp(`^${journalPrefix}/[a-f0-9-]{36}\\.json$`).test(key))fail('unexpected_read');
      return readOnly.readJson(key,fallback);
    },
    writeJson:readOnly.writeJson,
  });
  const journal=await openChe168ReplayJournal({storage:pinnedStorage,artifactRunId,binding:journalBinding,
    initialCursor,apply:state.applyJournalEvent});
  return {
    version:1,readOnly:true,sourceHttpRequests:0,storageWrites:0,publicationPerformed:false,
    at:new Date().toISOString(),readStartedAt,baseline:'failed_first_bootstrap',
    stateEvidence:'archived_csv_plus_pinned_working_journal',
    snapshot:{date:config.date,binding,bytes:config.bytes,initialCursor,yearFrom,
      archiveComplete:true,allArchivedBytesVerified:true,parts:Math.ceil(config.bytes/(16*1024*1024))},
    csv:{totalRows:csv.totalRows,selectedRows:csv.selectedRows,...state.csv,afterCsv},
    journal:{headPinned:true,chainVerified:true,cursor:journal.cursor,changes:journal.changes,
      chunks:meta.value.chunks.length,bytes:meta.value.bytes,events:state.events},
    finalInventory:{...state.summary(),reconstructedFromPinnedJournal:true},
    actualCatalog:{found:!!manifest,version:manifest?.version??null,
      generationId:manifest?.generationId??null,updatedAt:manifest?.updatedAt??null,
      chinaCount:manifest?.markets?.china?.count??null,chinaUpdatedAt:manifest?.markets?.china?.updatedAt??null},
    publishedIntake:{found:!!saved,version:saved?.version??null,market:saved?.market??null,
      generationId:saved?.generationId??null,updatedAt:saved?.updatedAt??null,
      sourceFound:!!previous,provider:previous?.provider??null,cursor:previous?.cursor??null,
      snapshotBinding:previous?.snapshotBinding??null,hasReplica:!!previous?.replica,
      replicaCursor:previous?.replica?.cursor??null},
  };
}
