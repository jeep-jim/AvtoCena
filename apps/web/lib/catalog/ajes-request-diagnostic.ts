import {ajesPublicFailureReason} from './ajes-read-receipt';

const validationCodes={
 decode:['gzip_invalid','json_invalid'],
 page_shape:['root_not_array','row_limit_exceeded','row_not_object'],
 aggregate_shape:['total_invalid','count_row_count','make_name_missing'],
 empty_confirmation:['count_unavailable','count_unverified'],
} as const;
type ValidationPhase=keyof typeof validationCodes;
type ValidationCode=typeof validationCodes[ValidationPhase][number];
export type AjesResponseValidation={
 version:1;phase:ValidationPhase;code:ValidationCode;
 // wireBytes counts bytes supplied by fetch before our optional gzip decoder;
 // native fetch may already have decoded Content-Encoding. It is not a measure
 // of compressed network transfer bytes.
 wireBytes?:number;decodedBytes?:number;rootKind?:'array'|'object'|'string'|'number'|'boolean'|'null';rowCount?:number;originCode?:string;
};
/** Private response diagnostics contain only finite classifications and bounded
 * counts. Unknown fields/versions and untrusted strings invalidate the block;
 * an older saved failure without this optional block remains usable. */
export function sanitizeAjesResponseValidation(value:unknown):AjesResponseValidation|undefined {
 if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
 let descriptors:PropertyDescriptorMap;try{descriptors=Object.getOwnPropertyDescriptors(value);}catch{return undefined;}
 if(Reflect.ownKeys(descriptors).some(key=>typeof key!=='string')||Object.values(descriptors).some(field=>field.get||field.set))return undefined;
 const row=Object.fromEntries(Object.entries(descriptors).map(([key,field])=>[key,field.value])) as AjesResponseValidation;
 if(row.version!==1||typeof row.phase!=='string'||typeof row.code!=='string'
  ||Object.keys(row).some(key=>!['version','phase','code','wireBytes','decodedBytes','rootKind','rowCount','originCode'].includes(key))
  ||!Object.prototype.hasOwnProperty.call(validationCodes,row.phase)
  ||!(validationCodes[row.phase] as readonly string[]).includes(row.code))return undefined;
 for(const key of ['wireBytes','decodedBytes','rowCount'] as const)
  if(Object.prototype.hasOwnProperty.call(row,key)&&(!Number.isSafeInteger(row[key])||row[key]!<0||row[key]!>2*1024*1024))return undefined;
 if(Object.prototype.hasOwnProperty.call(row,'rootKind')&&!['array','object','string','number','boolean','null'].includes(row.rootKind!))return undefined;
 if(Object.prototype.hasOwnProperty.call(row,'rowCount')&&row.rootKind!=='array')return undefined;
 if(row.phase==='empty_confirmation'){
  if(typeof row.originCode!=='string'||row.originCode!==ajesPublicFailureReason(row.originCode))return undefined;
 }else if(Object.prototype.hasOwnProperty.call(row,'originCode'))return undefined;
 return {version:1,phase:row.phase,code:row.code,
  ...(row.wireBytes!==undefined?{wireBytes:row.wireBytes}:{}),...(row.decodedBytes!==undefined?{decodedBytes:row.decodedBytes}:{}),
  ...(row.rootKind!==undefined?{rootKind:row.rootKind}:{}),...(row.rowCount!==undefined?{rowCount:row.rowCount}:{}),
  ...(row.originCode!==undefined?{originCode:row.originCode}:{})};
}

/** Private last failed real supplier request; never part of public catalog responses. */
export type AjesRequestDiagnostic = {
 table: 'stats'|'main'; kind: 'list'|'detail'|'count'|'models'|'makes'|'colors'; page:number; pageSize:number;
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
 const {responseValidation:raw,...prior}=value,responseValidation=sanitizeAjesResponseValidation(raw);
 const record={...prior,...(responseValidation?{responseValidation}:{})};
 if(Buffer.byteLength(JSON.stringify(record))>64*1024)return;
 await Promise.all([
  storage.writeJson(`integrations/ajes/catalog-failure-${value.table}.json`,record),
  storage.writeJson(`integrations/ajes/catalog-failure-pages/${ajesFailureSlot(value)}.json`,record),
 ]);
}
