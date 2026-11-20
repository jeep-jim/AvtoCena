import {createHash} from 'node:crypto';
import {ObjectJsonStorage} from './apps/web/lib/data';
import {CHINA_PUBLIC_CONTROL,readChinaPublicState,readConfiguredRegcloudScope,chinaLegacyRollback} from './apps/web/lib/catalog/china-regcloud-object-reader';
const RUN='44765240609', HEAD='891a5e3ed885872b99487a47b7d88edd172b1665';
const CUT='gen_1795166586455_china44710087159', READY='1080f0664095d3ed784eb1134cf20ab89c0facd33489b82f575eb7d279eb7cb6';
const CONTROL='9e3f73d6282465019f43dcd0370bf9c71688445a0e361dccf641bd45acc5be62';
const ROOT='catalog/nonjp-intake/v1/china/'+RUN+'/1';
const ARCHIVE_PIN='nonjp-intake-china-'+RUN+'-1', COLLECTOR_PIN='che168-intake-'+RUN+'-1';
const KEYS={archive:ROOT+'/complete.json',archivePin:'catalog/raw-feed-pins/v1/'+ARCHIVE_PIN+'.json',
 collectorPin:'catalog/raw-feed-pins/v1/'+COLLECTOR_PIN+'.json'} as const;
const scope={endpoint:'https://s3.regru.cloud',bucket:'avtocena-staging-8120751',region:'us-east-1',prefix:'migration-staging/full-20261011'};
const H=/^[a-f0-9]{64}$/;
type V=Record<string,any>;
const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const iso=(x:unknown)=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(x)&&Number.isFinite(Date.parse(x))?x:null;
const owner=(x:any)=>x?.runId===RUN&&x?.attempt==='1'&&x?.revision===HEAD;
const need=(v:unknown,why:string)=>{if(!v)throw Error('forensic_'+why)};
export function classify(body:Buffer|null,role:keyof typeof KEYS,archiveDigest?:string){
 if(body===null)return {state:'absent' as const};
 const digest=sha(body);
 try{
  const x=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body)) as V;
  if(!owner(x.owner))return {state:'other_or_ambiguous_owner' as const,digest};
  if(role==='archive'){
   if(x.kind!=='nonjp-intake'||x.market!=='china'||x.collection?.complete!==true||!H.test(x.reportDigest)||
    !Array.isArray(x.files)||x.files.length<1||x.files.length>10_000)return {state:'malformed' as const,digest};
   return {state:'complete_manifest' as const,digest,manifestDigest:sha(JSON.stringify(x)),reportDigest:x.reportDigest,fileCount:x.files.length};
  }
  if(x.operationId!==(role==='archivePin'?ARCHIVE_PIN:COLLECTOR_PIN)||!Array.isArray(x.references)||x.references.length>12||
     !['loading','ready','published','abandoned'].includes(x.state))
   return {state:'malformed' as const,digest};
  const matchedArchive=role==='archivePin'&&Boolean(archiveDigest)&&x.references.some((q:any)=>q?.root===ROOT&&q?.kind==='nonjp-intake'&&q?.sha256===archiveDigest);
  return {state:x.state as 'loading'|'ready'|'published'|'abandoned',digest,referenceCount:x.references.length,matchedArchive,updatedAt:iso(x.updatedAt),readyAt:iso(x.readyAt)};
 }catch{return {state:'malformed' as const,digest};}
}
async function run(){
 const c=readConfiguredRegcloudScope();
 need(Object.entries(scope).every(([k,v])=>c[k as keyof typeof c]===v),'storage_scope');
 const old=globalThis.fetch, root='/'+scope.bucket+'/'+scope.prefix+'/', allowed=new Set<string>([CHINA_PUBLIC_CONTROL,...Object.values(KEYS)]);
 const deadline=Date.now()+35_000;let calls=0;
 globalThis.fetch=async(raw,init)=>{
  need((typeof raw==='string'||raw instanceof URL)&&init?.method==='GET'&&init.redirect==='error'&&Date.now()<deadline&&++calls<=8,'network_scope');
  const u=new URL(String(raw));
  need(u.origin===scope.endpoint&&!u.search&&!u.hash&&!u.username&&!u.password&&u.pathname.startsWith(root)&&allowed.has(decodeURIComponent(u.pathname.slice(root.length))),'url_scope');
  return old(raw,init);
 };
 try{
  const s=new ObjectJsonStorage(), before=await readChinaPublicState(s);
  if(!before||chinaLegacyRollback(before.state.active))throw Error('forensic_control_pin');
  need(!!before.etag&&before.checksum===CONTROL&&before.state.revision===5&&before.state.active.generationId===CUT&&before.state.active.readySha256===READY,'control_pin');
  const get=async(k:string)=>{
   try{return (await s.getBinaryBounded(k,4*1024*1024)).data;}
   catch(e){if(e instanceof Error&&e.message==='object_storage_binary_read_404')return null;throw e;}
  };
  const [a,b,d]=await Promise.all([get(KEYS.archive),get(KEYS.archivePin),get(KEYS.collectorPin)]);
  const archive=classify(a,'archive');
  const archivePin=classify(b,'archivePin','manifestDigest' in archive?archive.manifestDigest:undefined);
  const collectorPin=classify(d,'collectorPin');
  const after=await readChinaPublicState(s);
  need(after?.etag===before.etag&&after.checksum===before.checksum,'control_moved');
  console.log(JSON.stringify({status:'china_daily_v4_run_metadata_only',runId:RUN,generationId:CUT,verifiedPreviouslyAppliedCursor:13123821,activeControlEtagSha256:sha(before.etag),
   archive,archivePin,collectorPin,journal:'not_read_no_authenticated_root',sourceCallsInCollectorRun:'unknown',chargesInCollectorRun:'unknown',readOnlyStorageGets:calls,storageWritesByProbe:0}));
 }finally{globalThis.fetch=old;}
}
if(process.argv.includes('--read-exact-v4')){
 try{await run()}catch(e){const m=e instanceof Error?e.message:'';console.log(JSON.stringify({status:'held',reason:/^forensic_[a-z_]+$/.test(m)?m:'forensic_read_unverified'}));process.exitCode=1}
}
