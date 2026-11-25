// Diagnostic only. Bundle against the exact deployed d536 source tree.
// The two admitted supplier queries run through its normal owner/quota controls.
import {gunzipSync} from 'node:zlib';
import {getJsonStorage} from './apps/web/lib/data';
import {createAjesClient, AjesUnavailable} from './apps/web/lib/catalog/ajes-client';
import {ajesQuery, type AjesQuery, type AjesTable} from './apps/web/lib/catalog/ajes-query';
import {ajesPassword} from './apps/web/lib/catalog/ajes-settings';
import {ajesEndpoint} from './apps/web/lib/catalog/ajes-routing';
import {assertCollectionEnabled, clearCollectionControlsCache} from './apps/web/lib/catalog/collection-controls';
import {reserveAjesRequest} from './apps/web/lib/catalog/ajes-quota';

// BEGIN PURE SUMMARY HELPERS
// Kept valid JavaScript so the exact disclosure boundary has an offline test.
const CONSUMED_FIELDS = new Set('ID YEAR AUCTION_TYPE MARKA_NAME MODEL_NAME STATUS FINISH IMAGES GRADE COLOR EQUIP KPP_TYPE TOWN KUZOV SERIAL MILEAGE ENG_V AUCTION LOT AUCTION_DATE RATE MONTH START PW PRIV KPP TIME FUEL INFO BODY_TYPE VEHICLE_CATEGORY'.split(' '));
function fieldName(value) {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(value) ? value : null;
}
function stamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}
function present(value) {
  return value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '');
}
function valueType(value) {
  return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
}
function numericSourceShape(value) {
  if (!present(value)) return {kind:'missing', rawNumeric:null};
  if (typeof value !== 'number' && typeof value !== 'string') return {kind:'non_numeric', rawNumeric:null};
  const text = String(value).trim();
  if (!text || text.length > 120 || !/^\d+(?:\.\d+)?(?:\s*[,;]\s*\d+(?:\.\d+)?)*$/.test(text)) return {kind:'non_numeric', rawNumeric:null};
  const values = text.split(/[,;]/).map(Number);
  if (values.length > 12 || values.some(v => !Number.isFinite(v) || v < 0 || v > 2500)) return {kind:'non_numeric', rawNumeric:null};
  return {kind:values.length === 1 ? 'scalar' : 'multiple', rawNumeric:text};
}
function infoShape(value) {
  const text = typeof value === 'string' ? value : '';
  return {
    present:present(value), type:valueType(value), bytes:Buffer.byteLength(text),
    hasPowerTerm:/power|horsepower|л\.?\s*с\.?|мощност|馬力|最高出力|最大出力/i.test(text),
    hasPowerUnit:/\b(?:kW|PS|hp)\b|кВт|л\.?\s*с\.?/i.test(text),
    hasDisplacementTerm:/displacement|engine\s*(?:size|capacity)|объ[её]м|排気量/i.test(text),
    hasTableMarkup:/<table\b/i.test(text)
  };
}
function summarizeRows(rows) {
  const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const acceptedNames = keys.map(fieldName).filter(Boolean).sort();
  const fields = acceptedNames.slice(0,128).map(name => {
    const values = rows.map(row => row[name]);
    const entry = {name, present:values.filter(present).length, types:[...new Set(values.map(valueType))].sort()};
    if (/^(?:PW|HP|PS|KW)$|POWER|HORSE|TORQUE|OUTPUT/i.test(name)) {
      const shapes = values.map(numericSourceShape);
      entry.powerShapeCounts = Object.fromEntries(['missing','scalar','multiple','non_numeric'].map(kind => [kind, shapes.filter(s => s.kind === kind).length]));
      entry.rawNumericExamples = [...new Set(shapes.map(s => s.rawNumeric).filter(v => v !== null))].slice(0,8);
    }
    return entry;
  });
  return {
    rowCount:rows.length, fieldCount:keys.length, omittedFieldNames:keys.length-fields.length,
    fields, fieldsNotReadByAjesLot:fields.map(f => f.name).filter(name => !CONSUMED_FIELDS.has(name)),
    info:rows.map(row => infoShape(row.INFO))
  };
}
function summarizeNormalized(lots) {
  return {
    items:lots.length,
    sourcePowerPresent:lots.filter(lot => present(lot.sourcePower)).length,
    sourcePowerShapes:lots.map(lot => numericSourceShape(lot.sourcePower)),
    powerHpPresent:lots.filter(lot => typeof lot.powerHp === 'number' && lot.powerHp > 0).length,
    infoPresent:lots.filter(lot => present(lot.info)).length,
    sourceDetailsPresent:lots.filter(lot => present(lot.sourceDetails)).length,
    engineCcPresent:lots.filter(lot => typeof lot.engineCc === 'number' && lot.engineCc > 0).length,
    sourceFuelPresent:lots.filter(lot => present(lot.sourceFuel)).length,
    equipmentPresent:lots.filter(lot => present(lot.equipment)).length,
    productionMonthPresent:lots.filter(lot => Number.isInteger(lot.productionMonth) && lot.productionMonth >= 1 && lot.productionMonth <= 12).length
  };
}
// END PURE SUMMARY HELPERS

const RELEASE = 'd536c1547c4d82a339ed68ced7d8503f09b6810b';
const MAX_BYTES = 2*1024*1024;
const EVIDENCE_KEY = 'catalog/partner-cache/ajes/evidence/stats-last-detail.json';
const CONFIG_KEY = 'integrations/ajes/config.json';
const CONTROLS_KEY = 'catalog/operations/collection-controls-v1.json';
const quotaKeys = new Set(['catalog/operations/ajes-quota-stats.json','catalog/operations/ajes-quota-main.json']);
let password:string|undefined;
const counters = {supplierRequests:0, objectRequests:0, quotaWrites:0, savedObjectsRead:0, sourceCacheWrites:0, objectListings:0};

function safeLog(stage:string, result:unknown) {
  const line=JSON.stringify({stage,...result as object});
  const secrets = [password, process.env.AJES_API_PASSWORD, process.env.AUTH_SECRET, process.env.NEXTAUTH_SECRET,
    process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID, process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY].filter((v):v is string => !!v && v.length >= 8);
  if (secrets.some(secret => line.includes(secret))) throw Error('diagnostic_disclosure_guard');
  const labels:Record<string,string>={saved_evidence:'JAPAN_SAVED_FIELD_AUDIT',saved_normalized_detail:'JAPAN_SAVED_FIELD_AUDIT',live_raw:'JAPAN_RAW_FIELD_AUDIT',live_normalized:'JAPAN_NORMALIZED_FIELD_AUDIT',live_stopped:'JAPAN_FIELD_AUDIT_FAILED',complete:'JAPAN_FIELD_AUDIT_COMPLETE'};
  if(!labels[stage])throw Error('diagnostic_log_stage_guard');
  console.log(labels[stage],line);
}
function safeReason(error:any) {
  if (error?.name === 'CollectionDisabledError') return 'source_disabled';
  const reason = error?.reason;
  return typeof reason === 'string' && /^(?:visitor_restricted|request_failed|request_timeout|connect_timeout|invalid_response|empty_response|response_too_large|identity_mismatch|query_too_large|quota_invalid|quota_busy|quota_exhausted|not_configured|http_[1-5]\d\d)$/.test(reason) ? reason : 'local_guard_or_read_failure';
}
async function boundedBody(response:Response) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) {
    await response.body?.cancel(); throw new AjesUnavailable('response_too_large');
  }
  const reader=response.body?.getReader();
  if (!reader) throw new AjesUnavailable('empty_response');
  const chunks:Uint8Array[]=[]; let length=0;
  while (true) {
    const next=await reader.read(); if(next.done)break;
    length+=next.value.length;
    if(length>MAX_BYTES){await reader.cancel();throw new AjesUnavailable('response_too_large');}
    chunks.push(next.value);
  }
  return Buffer.concat(chunks);
}
async function main() {
  const ip=process.env.AJES_DIAG_IP;
  if (ip !== '151.248.113.177' || process.env.AVTOCENA_RELEASE_SHA !== RELEASE || process.env.JSON_STORAGE_DRIVER !== 'object') throw Error('diagnostic_identity_guard');
  process.env.AVTOCENA_INTERACTIVE_READ_BUDGET_MS='5000';
  const storage=getJsonStorage();
  if(storage.driver!=='object')throw Error('diagnostic_storage_guard');
  const realFetch=globalThis.fetch;
  const bucket=process.env.YC_OBJECT_STORAGE_BUCKET;
  const prefix=String(process.env.YC_OBJECT_STORAGE_PREFIX||'').replace(/^\/+|\/+$/g,'');
  if(!bucket||/[/?#]/.test(bucket))throw Error('diagnostic_bucket_guard');
  const storagePath=(key:string)=>'/'+bucket+'/'+[prefix,key].filter(Boolean).join('/').split('/').map(encodeURIComponent).join('/');
  const allowedKeys=new Set([EVIDENCE_KEY,CONFIG_KEY,CONTROLS_KEY,...quotaKeys]);
  const originalRead=storage.readJsonWithMeta.bind(storage);
  storage.readJsonWithMeta=async function(key,fallback,previous){
    if(!allowedKeys.has(key))throw Error('diagnostic_saved_read_guard');
    return originalRead(key,fallback,previous);
  };
  const originalWrite=storage.writeJson.bind(storage);
  const writesByKey=new Map<string,number>();
  storage.writeJson=async(key,value,condition)=>{
    const writes=(writesByKey.get(key)||0)+1;
    const hasMatch=typeof condition?.ifMatch==='string'&&condition.ifMatch.length>0;
    const hasNone=condition?.ifNoneMatch==='*';
    if(!quotaKeys.has(key)||!condition||hasMatch===hasNone||writes>8)throw Error('diagnostic_quota_write_guard');
    writesByKey.set(key,writes); counters.quotaWrites++;
    return originalWrite(key,value,condition);
  };
  for(const method of ['deleteJson','putBinary','deleteBinary','deleteObjects','deletePrefix','listObjects','listBucketObjects','listObjectVersions','listMultipartUploads','createBinaryDownloadUrl']) {
    (storage as any)[method]=()=>{throw Error('diagnostic_storage_mutation_guard');};
  }
  globalThis.fetch=async(input,init={})=>{
    const url=new URL(input instanceof Request?input.url:String(input));
    const method=String(init.method??(input instanceof Request?input.method:'GET')).toUpperCase();
    const matchingKey=[...allowedKeys].find(key=>storagePath(key)===url.pathname);
    const headers=new Headers(init.headers);
    const conditionalPut=method==='PUT'&&matchingKey&&quotaKeys.has(matchingKey)&&(headers.has('if-match')||headers.get('if-none-match')==='*');
    if(url.origin!=='https://s3.regru.cloud'||!matchingKey||url.search||!(['GET','HEAD'].includes(method)||conditionalPut)||++counters.objectRequests>80)throw Error('diagnostic_storage_network_guard');
    return realFetch(input,{...init,redirect:'error'});
  };
  // Read the two existing objects only. No prefix or bucket listing is allowed.
  const evidence:any=await storage.readJson(EVIDENCE_KEY,null); counters.savedObjectsRead++;
  const id=typeof evidence?.id==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(evidence.id)?evidence.id:null;
  const savedFieldNames=Array.isArray(evidence?.fields)?evidence.fields.map(fieldName).filter(Boolean).slice(0,128):[];
  const evidenceValues=evidence?.values&&typeof evidence.values==='object'&&!Array.isArray(evidence.values)?evidence.values:{};
  safeLog('saved_evidence',{
    observedAt:stamp(evidence?.observedAt),present:!!evidence,hasValidExactId:!!id,
    fieldNames:savedFieldNames,knownValues:summarizeRows([evidenceValues]),
    rawValuesNotRetainedForFields:savedFieldNames.filter((name:string)=>!Object.prototype.hasOwnProperty.call(evidenceValues,name))
  });
  if(id){
    const key=`catalog/partner-cache/ajes/stats/${id}.json`;allowedKeys.add(key);
    const saved:any=await storage.readJson(key,null); counters.savedObjectsRead++;
    const lots=Array.isArray(saved?.items)&&saved.items.length===1&&saved.items[0]?.table==='stats'&&saved.items[0]?.id===id?saved.items:[];
    safeLog('saved_normalized_detail',{present:!!saved,identityBound:lots.length===1,observedAt:stamp(saved?.observedAt),schemaVersion:saved?.schemaVersion===2?2:null,...summarizeNormalized(lots)});
  }
  password=await ajesPassword();
  if(!password)throw new AjesUnavailable('not_configured');
  const endpoint=ajesEndpoint(ip);
  if(!['http://87.242.72.57/api/','http://78.46.90.228/api/'].includes(endpoint))throw Error('diagnostic_endpoint_guard');
  const inputs:AjesQuery[]=[id?{table:'stats',id}:{table:'stats',page:1,pageSize:3},{table:'main',page:1,pageSize:3}];
  let currentQuery:ReturnType<typeof ajesQuery>|null=null;
  let callsForCurrent=0;
  const fetcher:typeof fetch=async(input,init={})=>{
    const query=currentQuery;
    const url=new URL(input instanceof Request?input.url:String(input));
    if(!query||callsForCurrent!==0||counters.supplierRequests>=2||url.origin+url.pathname!==endpoint||
      url.searchParams.get('ip')!==ip||url.searchParams.get('code')!==password||url.searchParams.get('sql')!==query.sql||
      [...url.searchParams.keys()].sort().join(',')!=='code,ip,json,sql'||String(init.method??'GET').toUpperCase()!=='GET'||init.redirect!=='error')throw Error('diagnostic_supplier_guard');
    clearCollectionControlsCache();await assertCollectionEnabled('ajes_japan_feed');
    callsForCurrent++;counters.supplierRequests++;
    const started=Date.now();
    const response=await realFetch(input,init);
    const body=await boundedBody(response);
    let rawSummary:unknown=null,rawParse='unparsed';
    try{
      const decoded=body[0]===0x1f&&body[1]===0x8b?gunzipSync(body,{maxOutputLength:MAX_BYTES}):body;
      const rows=JSON.parse(decoded.toString('utf8'));
      if(Array.isArray(rows)&&rows.length<=query.pageSize&&rows.every(row=>row&&typeof row==='object'&&!Array.isArray(row))){
        rawSummary=summarizeRows(rows);rawParse='bounded_rows';
      }else rawParse='other_shape';
    }catch{rawParse='unparsed';}
    safeLog('live_raw',{table:query.table,kind:query.kind,pageSize:query.pageSize,httpStatus:response.status,elapsedMs:Date.now()-started,bodyBytes:body.length,rawParse,summary:rawSummary});
    // Return exactly the measured response bytes to the unmodified production parser.
    return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
  };
  const client=createAjesClient({
    password:async()=>password,endpoint:()=>endpoint,fetcher,
    assertEnabled:async(table?:AjesTable)=>{
      if(!currentQuery||table!==currentQuery.table)throw Error('diagnostic_table_guard');
      clearCollectionControlsCache();await assertCollectionEnabled('ajes_japan_feed');
    },
    reserve:async(table:AjesTable,kind?:string)=>{
      if(!currentQuery||table!==currentQuery.table||kind!==currentQuery.kind||callsForCurrent!==0)throw Error('diagnostic_reservation_guard');
      await reserveAjesRequest(storage,table);
    }
    // Deliberately no cache reader, cache writer, evidence writer, failure writer,
    // alternate cluster, or retry callbacks. Only usage accounting can be written.
  });
  for(const input of inputs){
    currentQuery=ajesQuery(input);callsForCurrent=0;
    if(!['list','detail'].includes(currentQuery.kind)||currentQuery.page!==1||currentQuery.pageSize>3)throw Error('diagnostic_bounded_query_guard');
    try{
      const result=await client.read(input,ip);
      safeLog('live_normalized',{table:currentQuery.table,kind:currentQuery.kind,observedAt:stamp(result.observedAt),received:result.received,rejected:result.rejected,stale:result.stale===true,...summarizeNormalized(result.items)});
      if(callsForCurrent!==1||result.stale)throw Error('diagnostic_fresh_read_guard');
    }catch(error){
      safeLog('live_stopped',{table:currentQuery.table,kind:currentQuery.kind,reason:safeReason(error),noFurtherSupplierRequests:true});
      throw error;
    }
  }
  safeLog('complete',{...counters,queriesCompleted:2,release:RELEASE});
}
main().catch(error=>{
  console.log('JAPAN_FIELD_AUDIT_FAILED',JSON.stringify({stage:'failed',reason:safeReason(error),...counters}));
  process.exitCode=1;
});
