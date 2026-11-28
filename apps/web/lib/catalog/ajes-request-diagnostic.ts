import {ajesPublicFailureReason} from './ajes-read-receipt';

const validationCodes={
 decode:['gzip_invalid','json_invalid'],
 page_shape:['root_not_array','row_limit_exceeded','row_not_object'],
 aggregate_shape:['total_invalid','count_row_count','make_name_missing'],
 empty_confirmation:['count_unavailable','count_unverified'],
 http_status:['non_success_status'],
} as const;
type ValidationPhase=keyof typeof validationCodes;
type ValidationCode=typeof validationCodes[ValidationPhase][number];
const httpBodyLimit=4096,httpBodyReadLimit=32,httpBodyTimeLimitMs=200;
const httpBodyStops=['complete','byte_limit','read_limit','time_limit','deadline','read_error','no_body'] as const;
const httpBodyFlags=['gzip','sqlSyntax','unknownColumn','unsupportedQuery','accessRefusal','credentialError','shortBotOrBan'] as const;
export type AjesHttpBodyDiagnostic={
 inspectedBytes:number;truncated:boolean;stop:typeof httpBodyStops[number];
 gzip:boolean;sqlSyntax:boolean;unknownColumn:boolean;unsupportedQuery:boolean;accessRefusal:boolean;credentialError:boolean;shortBotOrBan:boolean;
};
export type AjesListWindow={
 windowSize:number;identityRowCount:number;uniqueIdCount:number;
 fingerprints?:{orderedIdsSha256:string;firstWindowSha256:string;nextWindowSha256:string};
};
export type AjesResponseValidation={
 version:1;phase:ValidationPhase;code:ValidationCode;
 // wireBytes counts bytes supplied by fetch before our optional gzip decoder;
 // native fetch may already have decoded Content-Encoding. It is not a measure
 // of compressed network transfer bytes.
 wireBytes?:number;decodedBytes?:number;rootKind?:'array'|'object'|'string'|'number'|'boolean'|'null';rowCount?:number;originCode?:string;listWindow?:AjesListWindow;httpBody?:AjesHttpBodyDiagnostic;
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
function sanitizeHttpBody(value:unknown):AjesHttpBodyDiagnostic|undefined {
 const row=ownData(value,['inspectedBytes','truncated','stop',...httpBodyFlags]);
 if(!row||!Number.isSafeInteger(row.inspectedBytes)||Number(row.inspectedBytes)<0||Number(row.inspectedBytes)>httpBodyLimit
  ||typeof row.stop!=='string'||!(httpBodyStops as readonly string[]).includes(row.stop)
  ||typeof row.truncated!=='boolean'||row.truncated!==!['complete','no_body'].includes(row.stop)
  ||httpBodyFlags.some(key=>typeof row[key]!=='boolean'))return undefined;
 if(row.stop==='byte_limit'&&row.inspectedBytes!==httpBodyLimit)return undefined;
 if(row.stop==='no_body'&&row.inspectedBytes!==0)return undefined;
 if(row.inspectedBytes===0&&httpBodyFlags.some(key=>row[key]))return undefined;
 if(row.gzip&&(Number(row.inspectedBytes)<2||httpBodyFlags.some(key=>key!=='gzip'&&row[key])))return undefined;
 if(row.shortBotOrBan&&(row.stop!=='complete'||Number(row.inspectedBytes)>256||!row.accessRefusal))return undefined;
 return {inspectedBytes:row.inspectedBytes as number,truncated:row.truncated,stop:row.stop as AjesHttpBodyDiagnostic['stop'],
  gzip:row.gzip as boolean,sqlSyntax:row.sqlSyntax as boolean,unknownColumn:row.unknownColumn as boolean,unsupportedQuery:row.unsupportedQuery as boolean,
  accessRefusal:row.accessRefusal as boolean,credentialError:row.credentialError as boolean,shortBotOrBan:row.shortBotOrBan as boolean};
}
/** These flags record literal error markers, not a proven cause. An absent
 * marker never excludes a failure class, especially in an incomplete prefix.
 * Raw bytes, matched strings, provider codes and headers never leave here. */
function httpBodyValidation(prefix:Uint8Array,stop:AjesHttpBodyDiagnostic['stop']):AjesResponseValidation {
 const gzip=prefix[0]===0x1f&&prefix[1]===0x8b;
 // Native fetch normally decodes Content-Encoding. Never expand an additional
 // compressed error payload: the diagnostic has its own small byte/time bound.
 const text=gzip?'':Buffer.from(prefix).toString('utf8');
 const shortBotOrBan=stop==='complete'&&prefix.length<=256&&/^\s*(?:bot|ban)\d*(?:\s|$)/i.test(text);
 const httpBody:AjesHttpBodyDiagnostic={inspectedBytes:prefix.length,truncated:!['complete','no_body'].includes(stop),stop,gzip,
  sqlSyntax:/\b(?:error in your sql syntax|sql syntax error|syntax error at or near)\b/i.test(text),
  unknownColumn:/\bunknown column\b|\bcolumn\b[^\r\n]{0,160}\bdoes not exist\b/i.test(text),
  unsupportedQuery:/\b(?:unsupported (?:sql|query|statement|syntax)|(?:sql|query|statement|syntax) (?:is )?not supported|does(?:n't| not) yet support)\b/i.test(text),
  accessRefusal:shortBotOrBan||/\b(?:access denied|permission denied|forbidden|visitor[_ ]restricted|request (?:blocked|denied)|access (?:refused|blocked))\b/i.test(text),
  credentialError:/\b(?:(?:invalid|incorrect|wrong|missing|expired|bad) (?:api[ _-]?)?(?:key|password|credentials?|token|code)|authentication (?:failed|required)|access denied for user)\b/i.test(text),shortBotOrBan};
 return {version:1,phase:'http_status',code:'non_success_status',httpBody};
}
/** Inspect only the response already received by the ordinary request. Retain
 * at most 4 KiB, perform at most 32 reads, and stop within 200 ms or the existing
 * request deadline. A transport chunk can exceed the prefix; its excess is
 * neither copied nor inspected. Cancellation itself must not hold the caller. */
export async function inspectAjesHttpFailureResponse(response:Response,signal:AbortSignal,deadlineAt:number):Promise<AjesResponseValidation> {
 const prefix=new Uint8Array(httpBodyLimit);let inspected=0,stop:AjesHttpBodyDiagnostic['stop']='no_body';
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,timer:ReturnType<typeof setTimeout>|undefined,onAbort:(()=>void)|undefined;
 try{
  reader=response.body?.getReader();
  if(reader){
   const timeLeft=Math.min(httpBodyTimeLimitMs,deadlineAt-Date.now());
   if(signal.aborted||!Number.isFinite(timeLeft)||timeLeft<=0)stop='deadline';
   else{
    const bodyDeadline=Date.now()+timeLeft;
    type Interrupted={kind:'stop';stop:'deadline'|'time_limit'};
    let interrupt!:(value:Interrupted)=>void;
    const interrupted=new Promise<Interrupted>(resolve=>{interrupt=resolve;});
    onAbort=()=>interrupt({kind:'stop',stop:'deadline'});
    signal.addEventListener('abort',onAbort,{once:true});
    timer=setTimeout(()=>interrupt({kind:'stop',stop:Date.now()>=deadlineAt?'deadline':'time_limit'}),timeLeft);
    stop='read_limit';
    for(let reads=0;reads<httpBodyReadLimit;reads++){
     if(signal.aborted||Date.now()>=deadlineAt){stop='deadline';break;}
     if(Date.now()>=bodyDeadline){stop='time_limit';break;}
     const result=await Promise.race([reader.read().then(value=>({kind:'read' as const,value}),()=>({kind:'error' as const})),interrupted]);
     if(result.kind==='stop'){stop=result.stop;break;}
     if(result.kind==='error'){stop='read_error';break;}
     if(result.value.done){stop='complete';break;}
     const value=result.value.value;
     const take=Math.min(value.byteLength,httpBodyLimit-inspected);
     prefix.set(value.subarray(0,take),inspected);inspected+=take;
     if(inspected===httpBodyLimit){stop='byte_limit';break;}
    }
   }
  }
 }catch{stop='read_error';}
 finally{
  if(timer!==undefined)clearTimeout(timer);
  if(onAbort)signal.removeEventListener('abort',onAbort);
  try{void reader?.cancel().catch(()=>{});}catch{}
 }
 return httpBodyValidation(prefix.subarray(0,inspected),stop);
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
 const row=ownData(value,['version','phase','code','wireBytes','decodedBytes','rootKind','rowCount','originCode','listWindow','httpBody']) as AjesResponseValidation|undefined;
 if(!row||row.version!==1||typeof row.phase!=='string'||typeof row.code!=='string'
  ||!Object.prototype.hasOwnProperty.call(validationCodes,row.phase)
  ||!(validationCodes[row.phase] as readonly string[]).includes(row.code))return undefined;
 if(row.phase==='http_status'){
  if(Object.keys(row).some(key=>!['version','phase','code','httpBody'].includes(key)))return undefined;
  const httpBody=sanitizeHttpBody(row.httpBody);
  return httpBody?{version:1,phase:'http_status',code:'non_success_status',httpBody}:undefined;
 }
 if(Object.prototype.hasOwnProperty.call(row,'httpBody'))return undefined;
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
 if(responseValidation?.phase==='http_status'&&(!Number.isSafeInteger(value.httpStatus)||value.httpStatus!<300||value.httpStatus!>599
  ||value.outcome!==(value.httpStatus===414?'query_too_large':`http_${value.httpStatus}`)))responseValidation=undefined;
 const record={...prior,...(responseValidation?{responseValidation}:{})};
 if(Buffer.byteLength(JSON.stringify(record))>64*1024)return;
 await Promise.all([
  storage.writeJson(`integrations/ajes/catalog-failure-${value.table}.json`,record),
  storage.writeJson(`integrations/ajes/catalog-failure-pages/${ajesFailureSlot(value)}.json`,record),
 ]);
}
