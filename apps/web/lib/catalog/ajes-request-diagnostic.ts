import {ajesPublicFailureReason} from './ajes-read-receipt';

const validationCodes={
 decode:['gzip_invalid','json_invalid'],
 page_shape:['root_not_array','row_limit_exceeded','row_not_object'],
 aggregate_shape:['total_invalid','count_row_count','make_name_missing'],
 empty_confirmation:['count_unavailable','count_unverified'],
} as const;
type ValidationPhase=keyof typeof validationCodes;
type ValidationCode=typeof validationCodes[ValidationPhase][number];
export type AjesListWindow={
 windowSize:number;identityRowCount:number;uniqueIdCount:number;
 fingerprints?:{orderedIdsSha256:string;firstWindowSha256:string;nextWindowSha256:string};
};
export type AjesResponseValidation={
 version:1;phase:ValidationPhase;code:ValidationCode;
 // wireBytes counts bytes supplied by fetch before our optional gzip decoder;
 // native fetch may already have decoded Content-Encoding. It is not a measure
 // of compressed network transfer bytes.
 wireBytes?:number;decodedBytes?:number;rootKind?:'array'|'object'|'string'|'number'|'boolean'|'null';rowCount?:number;originCode?:string;listWindow?:AjesListWindow;
};
function ownData(value:unknown,keys:readonly string[]):Record<string,unknown>|undefined {
 if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
 try{
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null)return undefined;
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(descriptors).some(key=>typeof key!=='string'||!keys.includes(key))
   ||Object.values(descriptors).some(field=>!Object.prototype.hasOwnProperty.call(field,'value')))return undefined;
  return Object.fromEntries(Object.entries(descriptors).map(([key,field])=>[key,field.value]));
 }catch{return undefined;}
}
function sanitizeListWindow(value:unknown,rowCount:number):AjesListWindow|undefined {
 const row=ownData(value,['windowSize','identityRowCount','uniqueIdCount','fingerprints']);
 if(!row||!Number.isSafeInteger(rowCount)||rowCount>96
  ||!Number.isSafeInteger(row.windowSize)||Number(row.windowSize)<1||Number(row.windowSize)>48||rowCount<2*Number(row.windowSize)
  ||!Number.isSafeInteger(row.identityRowCount)||Number(row.identityRowCount)<0||Number(row.identityRowCount)>rowCount
  ||!Number.isSafeInteger(row.uniqueIdCount)||Number(row.uniqueIdCount)<0||Number(row.uniqueIdCount)>Number(row.identityRowCount))return undefined;
 let fingerprints:AjesListWindow['fingerprints'];
 if(Object.prototype.hasOwnProperty.call(row,'fingerprints')){
  const hashes=ownData(row.fingerprints,['orderedIdsSha256','firstWindowSha256','nextWindowSha256']);
  if(!hashes||row.identityRowCount!==rowCount||row.uniqueIdCount!==rowCount
   ||['orderedIdsSha256','firstWindowSha256','nextWindowSha256'].some(key=>typeof hashes[key]!=='string'||!/^[a-f0-9]{64}$/.test(hashes[key])))return undefined;
  fingerprints={orderedIdsSha256:hashes.orderedIdsSha256 as string,firstWindowSha256:hashes.firstWindowSha256 as string,nextWindowSha256:hashes.nextWindowSha256 as string};
 }
 return {windowSize:row.windowSize as number,identityRowCount:row.identityRowCount as number,uniqueIdCount:row.uniqueIdCount as number,...(fingerprints?{fingerprints}:{})};
}
/** Private response diagnostics contain only finite classifications and bounded
 * counts. Unknown fields/versions and untrusted strings invalidate the block;
 * an older saved failure without this optional block remains usable. */
export function sanitizeAjesResponseValidation(value:unknown):AjesResponseValidation|undefined {
 const row=ownData(value,['version','phase','code','wireBytes','decodedBytes','rootKind','rowCount','originCode','listWindow']) as AjesResponseValidation|undefined;
 if(!row||row.version!==1||typeof row.phase!=='string'||typeof row.code!=='string'
  ||!Object.prototype.hasOwnProperty.call(validationCodes,row.phase)
  ||!(validationCodes[row.phase] as readonly string[]).includes(row.code))return undefined;
 for(const key of ['wireBytes','decodedBytes','rowCount'] as const)
  if(Object.prototype.hasOwnProperty.call(row,key)&&(!Number.isSafeInteger(row[key])||row[key]!<0||row[key]!>2*1024*1024))return undefined;
 if(Object.prototype.hasOwnProperty.call(row,'rootKind')&&!['array','object','string','number','boolean','null'].includes(row.rootKind!))return undefined;
 if(Object.prototype.hasOwnProperty.call(row,'rowCount')&&row.rootKind!=='array')return undefined;
 if(row.phase==='empty_confirmation'){
  if(typeof row.originCode!=='string'||row.originCode!==ajesPublicFailureReason(row.originCode))return undefined;
 }else if(Object.prototype.hasOwnProperty.call(row,'originCode'))return undefined;
 let listWindow:AjesListWindow|undefined;
 if(Object.prototype.hasOwnProperty.call(row,'listWindow')){
  if(row.phase!=='page_shape'||row.code!=='row_limit_exceeded'||row.rootKind!=='array')return undefined;
  listWindow=sanitizeListWindow(row.listWindow,row.rowCount!);
  if(!listWindow)return undefined;
 }
 return {version:1,phase:row.phase,code:row.code,
  ...(row.wireBytes!==undefined?{wireBytes:row.wireBytes}:{}),...(row.decodedBytes!==undefined?{decodedBytes:row.decodedBytes}:{}),
  ...(row.rootKind!==undefined?{rootKind:row.rootKind}:{}),...(row.rowCount!==undefined?{rowCount:row.rowCount}:{}),
  ...(row.originCode!==undefined?{originCode:row.originCode}:{}),...(listWindow?{listWindow}:{})};
}

/** Private last failed real supplier request; never part of public catalog responses. */
export type AjesRequestDiagnostic = {
 table: 'stats'|'main'; kind: 'list'|'detail'|'count'|'models'|'makes'|'colors'|'census'; page:number; pageSize:number;
 startedAt:string; finishedAt:string; clientIp:string; sql:string; endpoint:string;
 httpStatus:number|null; providerCode:string|null; outcome:string;
 responseValidation?:AjesResponseValidation;
};

// Fixed slots: eight early pages, one later-page slot and five other kinds per
// table. No per-visitor files and no unbounded request history.
export function ajesFailureSlot(value:Pick<AjesRequestDiagnostic,'table'|'kind'|'page'>){
 const kind=value.kind==='list'?`list-${Number.isSafeInteger(value.page)&&value.page>=1&&value.page<=8?value.page:'later'}`:value.kind;
 return `${value.table}-${kind}`;
}
export async function saveAjesRequestFailure(storage:{writeJson:(key:string,value:any)=>Promise<unknown>},value:AjesRequestDiagnostic){
 const {responseValidation:raw,...prior}=value;
 let responseValidation=sanitizeAjesResponseValidation(raw);
 if(responseValidation?.listWindow&&(value.kind!=='list'||value.pageSize!==responseValidation.listWindow.windowSize))responseValidation=undefined;
 const record={...prior,...(responseValidation?{responseValidation}:{})};
 if(Buffer.byteLength(JSON.stringify(record))>64*1024)return;
 await Promise.all([
  storage.writeJson(`integrations/ajes/catalog-failure-${value.table}.json`,record),
  storage.writeJson(`integrations/ajes/catalog-failure-pages/${ajesFailureSlot(value)}.json`,record),
 ]);
}
