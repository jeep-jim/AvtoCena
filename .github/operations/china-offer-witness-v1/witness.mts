import {createHash} from 'node:crypto';
import {ObjectJsonStorage} from './apps/web/lib/data';
import {CHINA_PUBLIC_CONTROL,chinaLegacyRollback,openConfiguredChinaRegcloudFiles,readChinaPublicState,readConfiguredRegcloudScope} from './apps/web/lib/catalog/china-regcloud-object-reader';
import {openIndependentChinaRegcloud} from './apps/web/lib/catalog/independent-market-activation-fixture';
import {openPreparedChinaSnapshot} from './apps/web/lib/catalog/prepared-china-fixture-activation';
import type {CatalogPreparedChinaManifest} from './apps/web/lib/catalog/storage';
const ID='f011736e0fada0af4e0a7491', INNER='54839432';
const SHA='9e3f73d6282465019f43dcd0370bf9c71688445a0e361dccf641bd45acc5be62';
const READY='1080f0664095d3ed784eb1134cf20ab89c0facd33489b82f575eb7d279eb7cb6';
const GEN='gen_1795166586455_china44710087159', RUN='full-fresh-44710087159-1';
const SCOPE={endpoint:'https://s3.regru.cloud',bucket:'avtocena-staging-8120751',region:'us-east-1',prefix:'migration-staging/full-20261011'};
const PREFIX='/'+SCOPE.bucket+'/'+SCOPE.prefix+'/', STAGE='catalog/private-market-stage-v1/china/'+RUN+'/';
const need=(ok:unknown,why:string)=>{if(!ok)throw Error('witness_'+why);};
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const time=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
export function ordinal(chunks:string[],count:number,location:{chunk:string,part:number,offset:number},rows:number[]){
 need(Number.isSafeInteger(count)&&count>0&&chunks.length===Math.ceil(count/500)&&chunks.every((x,i)=>x==='chunk-'+String(i+1).padStart(4,'0')),'dense_chunks');
 const n=chunks.indexOf(location.chunk);
 need(n>=0&&rows.every(x=>Number.isSafeInteger(x)&&x>=1&&x<=128)&&rows.reduce((a,b)=>a+b,0)===Math.min(500,count-n*500)&&
    Number.isSafeInteger(location.part)&&location.part>=0&&location.part<rows.length&&Number.isSafeInteger(location.offset)&&location.offset>=0&&location.offset<rows[location.part],'dense_part');
 return n*500+rows.slice(0,location.part).reduce((a,b)=>a+b,0)+location.offset;
}
async function main(){
 const conf=readConfiguredRegcloudScope();
 need(Object.entries(SCOPE).every(([k,v])=>conf[k as keyof typeof conf]===v),'scope');
 const base=globalThis.fetch,deadline=Date.now()+60_000;
 let gets=0;const seen=new Set<string>();
 // All stage reads are separately authorized by the exact signed reader and READY.
 globalThis.fetch=async(raw,init)=>{
  need((typeof raw==='string'||raw instanceof URL)&&init?.method==='GET'&&init?.redirect==='error','get_only');
  const u=new URL(String(raw));
  need(u.origin===SCOPE.endpoint&&!u.search&&!u.hash&&!u.username&&!u.password&&u.pathname.startsWith(PREFIX),'remote_scope');
  const key=decodeURIComponent(u.pathname.slice(PREFIX.length));
  need((key===CHINA_PUBLIC_CONTROL||key.startsWith(STAGE)&&key.split('/').every(x=>/^[a-zA-Z0-9_.-]+$/.test(x)&&x!=='.'&&x!=='..'))&&++gets<=45&&Date.now()<deadline,'get_budget');
  seen.add(key);const n=[...seen].filter(k=>k.includes('/indexes/prepared-china-read-v1/ids/')).length;
  need(n<=4&&[...seen].filter(k=>k.includes('/indexes/prepared-china-read-v1/chunks/')).length<=1&&
    [...seen].filter(k=>k.includes('/indexes/prepared-china-read-v1/projections/')).length<=1&&
    [...seen].filter(k=>/\.part-\d+\.json$/.test(k)).length<=1,'one_locator_branch_part');
  return base(raw,init);
 };
 try{
  const storage=new ObjectJsonStorage();
  const before=await readChinaPublicState(storage);
  if(!before||chinaLegacyRollback(before.state.active))throw Error('witness_pointer_absent');
  need(before.checksum===SHA&&before.state.revision===5&&before.state.active.generationId===GEN&&before.state.active.runId===RUN&&before.state.active.readySha256===READY&&!!before.etag,'pointer_pin');
  const stage=await openConfiguredChinaRegcloudFiles();
  if(!stage)throw Error('witness_ready_missing');
  need(stage.readySha256===READY&&stage.ready.generationId===GEN,'ready_pin');
  const p=await openIndependentChinaRegcloud(stage).openChinaPrepared();
  const payload=p.prices.payload as {manifest:CatalogPreparedChinaManifest};
  const snap=await openPreparedChinaSnapshot(payload.manifest,(key,h)=>p.read(key,h),p.assertCurrent,p.acceptedLegalUntil);
  need(snap.generationId===GEN&&snap.streamingSelector===true,'directory_binding');
  const loc=await snap.locate(ID);
  const out={kind:'china-offer-positional-witness-v1',generationId:GEN,controlSha256:SHA,controlEtagSha256:sha(before.etag),readySha256:READY,directorySha256:snap.directorySha256,
    found:loc!==null,admittedCount:snap.rows,sourceGroup:loc?'autohome_used_china_open':null,providerOfferId:loc?INNER:null,ordinal:null as number|null,year:null as number|null,archivedNativeUpdatedAt:null as string|null,sourceEditedAt:null,sourceEditedAtVerified:false,supplierRequests:0,storageWrites:0,signedStorageGets:0};
  if(loc){
   const chunk=await snap.readChunk(loc.chunk);
   out.ordinal=ordinal(snap.chunks,snap.rows,loc,chunk.partRows);
   const part=await chunk.load(loc.part);
   const native=(await part.loadNativePart())[loc.offset];
   need(native?.id===ID&&part.projection.items[loc.offset]?.id===ID&&native.sourceId==='autohome_used_china_open'&&native.operational?.provider==='auto-api.com'&&native.sourceOfferId===INNER&&
      native.market==='china'&&native.operational?.detailIdentityVerified===true&&Number.isSafeInteger(native.year),'native_identity');
   out.year=native.year;out.archivedNativeUpdatedAt=time(native.updatedAt);
  }
  await snap.assertCurrent();
  const after=await readChinaPublicState(storage);
  need(after?.checksum===SHA&&after.etag===before.etag,'pointer_moved');
  out.signedStorageGets=gets;console.log(JSON.stringify(out));
 }finally{globalThis.fetch=base;}
}
if(process.argv.includes('--exact-read-only')){
 try{await main()}catch(e){const msg=e instanceof Error?e.message:'';console.log(JSON.stringify({status:'held',reason:/^witness_[a-z_]+$/.test(msg)?msg:'verification_unavailable',storageWrites:0,supplierRequests:0}));process.exitCode=1}
}
