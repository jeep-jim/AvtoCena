// Production-scope read-only carrier. Two signed metadata fences and one
// hydration; no cloud writer, provider client, cursor or publication code.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,createHmac} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {exactV4PinRoles,exactV4SealedReadPlan,inspectExactV4Custody} from './custody.mjs';

const M=1024**2,CHUNK=16*M,MAX_JOURNAL=512*M,MAX_METADATA=12*M;
const HOST='s3.regru.cloud',PREFIX='/avtocena-staging-8120751/migration-staging/full-20261011/',REGION='us-east-1';
const ROOT_CONTROL='catalog/independent-market-public-v1/china/control.json';
const READY='catalog/private-market-stage-v1/china/full-fresh-44710087159-1/READY.json';
const PIN='catalog/raw-feed-pins/v1/che168-intake-44765240609-1.json';
const controlSha='9e3f73d6282465019f43dcd0370bf9c71688445a0e361dccf641bd45acc5be62';
const readySha='1080f0664095d3ed784eb1134cf20ab89c0facd33489b82f575eb7d279eb7cb6';
const pinSha='a14bda5ccf4c4e8a3920ff8858d6bad6a8d5307fad0d706dd8236650a9b4f4d2';
const controlEtagSha='447424f806e20f917cd2922e3c5f841a957410054fc05f9d8bba5bd18cfef79e';
const authMeta=Object.freeze({
 producerRun:'44765240609',producerOperator:'891a5e3ed885872b99487a47b7d88edd172b1665',workerTree:'4dbbe41885deab5ab80002147aa04738d1048e67',
 controlRev:5,controlSha256:controlSha,pinWireSha256:pinSha,
 candidateManifestSha256:'e55a984351971929609780d2aa588215b78eb51c1debb4da07e13621481e9a0d',
 journalHeadSha256:'36c279e55fd61db002a85b7720fd32980124ce4d60ea08cb8f985d9f2359f9c2',
 pinAndHeadsRechecked:true,privateObjectScopeAuthenticated:true,
});
export const budget=Object.freeze({candidateParts:178,encodedCandidateBytes:471890664,candidateRawBytes:2971688960,journalChunks:91,journalEvents:57020,
 journalWireLimit:MAX_JOURNAL,metadataWireLimit:MAX_METADATA,bodyGets:269,metadataGets:10,maxGet:279,windowsMs:18*60_000,minimumScratchBytes:5*1024**3,parallelCandidateRead:4});
const sha=x=>createHash('sha256').update(x).digest('hex');
const hmac=(key,s)=>createHmac('sha256',key).update(s).digest();
const parse=b=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
const req=(x,c)=>{if(!x)throw Error('china_v4_body_'+c);};
const safeKey=k=>typeof k==='string'&&k.split('/').every(p=>/^[A-Za-z0-9_.-]+$/.test(p)&&p!=='.'&&p!=='..');
const responseSize=x=>typeof x==='string'&&/^\d{1,12}$/.test(x)?Number(x):0;
const reqMeta=(v,shaExpected,code)=>req(v?.sha256===shaExpected,code);
const validMode=mode=>(mode&0o077)===0;

function makePort({fetcher=fetch,env=process.env,clock=Date.now}={}){
 const expires=clock()+budget.windowsMs,seen=new Map(),stats={metadata:0,candidate:0,journal:0,metadataBytes:0,candidateBytes:0,journalBytes:0};
 const empty=sha(''),allowed=new Map(),ceil={metadata:MAX_METADATA,candidate:budget.encodedCandidateBytes,journal:MAX_JOURNAL};
 function within(){req(clock()<expires,'global_read_deadline');}
 function authorize(key,kind,maximumUses,cap){
  req(!allowed.has(key)&&safeKey(key)&&Object.hasOwn(ceil,kind)&&Number.isSafeInteger(cap)&&cap>=1&&cap<=64*M&&
    (kind==='metadata'?maximumUses===1||maximumUses===2:maximumUses===1),'strict_signed_allowlist');
  allowed.set(key,{kind,maximumUses,cap});
 }
 async function get(key){
  within();
  const permit=allowed.get(key);
  req(permit&&(seen.get(key)??0)<permit.maximumUses&&stats.metadata+stats.candidate+stats.journal<budget.maxGet,'exact_get_only_scope');
  const {kind,cap}=permit,readCap={metadata:budget.metadataGets,candidate:budget.candidateParts,journal:budget.journalChunks};
  req(stats[kind]<readCap[kind],'exact_group_request_cap');stats[kind]++;seen.set(key,(seen.get(key)??0)+1);
  const access=env.YC_OBJECT_STORAGE_ACCESS_KEY_ID,secret=env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY;
  req(typeof access==='string'&&access.length>0&&typeof secret==='string'&&secret.length>0,'read_authority_required');
  const amz=new Date(clock()).toISOString().replace(/[:-]|\.\d{3}/g,''),day=amz.slice(0,8);
  const route=PREFIX+key,scope=day+'/'+REGION+'/s3/aws4_request';
  const names='host;x-amz-content-sha256;x-amz-date';
  const headers={host:HOST,'x-amz-content-sha256':empty,'x-amz-date':amz};
  const canonical='GET\n'+route+'\n\n'+['host','x-amz-content-sha256','x-amz-date'].map(n=>n+':'+headers[n]+'\n').join('')+'\n'+names+'\n'+empty;
  const signature=createHmac('sha256',hmac(hmac(hmac(hmac('AWS4'+secret,day),REGION),'s3'),'aws4_request'))
   .update(['AWS4-HMAC-SHA256',amz,scope,sha(canonical)].join('\n')).digest('hex');
  headers.authorization='AWS4-HMAC-SHA256 Credential='+access+'/'+scope+', SignedHeaders='+names+', Signature='+signature;
  const r=await fetcher('https://'+HOST+route,{method:'GET',headers,redirect:'error',
    signal:AbortSignal.timeout(Math.min(kind==='metadata'?12000:25000,expires-clock()))});
  const length=responseSize(r.headers.get('content-length')),etag=r.headers.get('etag');
  const bounded=r.status===200&&length>0&&length<=cap&&typeof etag==='string'&&/^(?:W\/)?"[^"\r\n]{1,128}"$/.test(etag)&&
    !r.headers.get('content-encoding');
  if(!bounded){await r.body?.cancel?.();req(false,'http_size_or_token_unbound');}
  const pieces=[];let bytes=0;
  for await(const part of r.body){
   within();bytes+=part.byteLength;stats[kind+'Bytes']+=part.byteLength;
   req(bytes<=length&&stats[kind+'Bytes']<=ceil[kind],'bounded_signed_body_overrun');pieces.push(part);
  }
  req(bytes===length,'body_length_readback_mismatch');
  const data=Buffer.concat(pieces,bytes);
  return {data,sha256:sha(data),etagSha256:sha(etag.replace(/^W\//,''))};
 }
 return Object.freeze({authorize,get,within,stats:()=>({...stats})});
}

function checkPublic(o){
 reqMeta(o,controlSha,'rev5_wire_changed');
 req(o.etagSha256===controlEtagSha,'rev5_etag_changed');
 const a=parse(o.data);
 req(a.version===1&&a.market==='china'&&a.revision===5&&a.active?.runId==='full-fresh-44710087159-1'&&
   a.active.generationId==='gen_1795166586455_china44710087159'&&a.active.readySha256===readySha,'rev5_active_changed');
}
function exactPlanStats(m,j){
 req(m.cursor===13180841&&m.bytes===budget.candidateRawBytes&&m.parts.length===budget.candidateParts&&
  j.initialCursor===13123821&&j.cursor===m.cursor&&j.changes===budget.journalEvents&&j.chunks.length===budget.journalChunks,
 'verified_metadata_exact_totals_changed');
}
async function diskRoot(scratch){
 req(typeof scratch==='string'&&path.isAbsolute(scratch)&&await fs.realpath(scratch)===scratch,'isolated_scratch_path');
 const meta=await fs.lstat(scratch);req(meta.isDirectory()&&validMode(meta.mode),'private_scratch_required');
 const stats=await fs.statfs(scratch,{bigint:true});
 req(stats.bavail*stats.bsize>=BigInt(budget.minimumScratchBytes),'private_scratch_insufficient');
}
async function hydrateCandidate({storage,manifest,root,filename}){
 const f=await fs.open(filename,'wx',0o600);
 let size=0;
 try{
  for(let start=0;start<manifest.parts.length;start+=budget.parallelCandidateRead){
   storage.within();
   const partial=manifest.parts.slice(start,start+budget.parallelCandidateRead);
   const wire=await Promise.all(partial.map((_,i)=>storage.get(root+'/'+(start+i)+'.gz')));
   for(const [off,v] of wire.entries()){
    const descriptor=partial[off],body=gunzipSync(v.data,{maxOutputLength:CHUNK});
    req(body.length===descriptor.bytes&&sha(body)===descriptor.sha256,'restored_replica_part_commitment_mismatch');
    size+=body.length;
    req(size<=manifest.bytes,'candidate_disk_size_bound');
    await f.writeFile(body);
   }
  }
  req(size===manifest.bytes,'candidate_file_missing_parts');await f.sync();
 }finally{await f.close();}
}

export async function runExactReadOnlyCustody({scratch,snapshotConfigFile,makeReader=()=>makePort(),diagnostic={phase:'preflight'}}){
 await diskRoot(scratch);
 const configPath=path.resolve(snapshotConfigFile);
 const st=await fs.lstat(configPath);
 req(st.isFile()&&st.size>0&&st.size<=128*1024&&await fs.realpath(configPath)===configPath,'pinned_original_config_file');
 const snapshotConfigWire=await fs.readFile(configPath);
 req(sha(snapshotConfigWire)==='25abfa4b8f1b053b12a1fcd86f01dc42de65eb8cb74f3863abf1a49115dfdb27','pinned_original_config_digest');
 const storage=makeReader();
 diagnostic.stats=storage.stats;
 diagnostic.phase='signed_public_and_custody_metadata';
 storage.authorize(ROOT_CONTROL,'metadata',2,32*1024);storage.authorize(PIN,'metadata',2,32*1024);storage.authorize(READY,'metadata',1,32*1024);
 const [control,pin,ready]=await Promise.all([storage.get(ROOT_CONTROL),storage.get(PIN),storage.get(READY)]);
 checkPublic(control);reqMeta(pin,pinSha,'old_custody_pin_changed');reqMeta(ready,readySha,'base_rev5_ready_changed');
 const roles=exactV4PinRoles(pin.data);
 const acceptedManifestKey=roles.previous.key+'/manifest.json',manifestKey=roles.candidateRoot+'/manifest.json',journalHeadKey=roles.journalRoot+'/head.json';
 storage.authorize(acceptedManifestKey,'metadata',1,2*M);storage.authorize(manifestKey,'metadata',2,2*M);storage.authorize(journalHeadKey,'metadata',2,2*M);
 const [oldMeta,candidateMeta,journalMeta]=await Promise.all([storage.get(acceptedManifestKey),storage.get(manifestKey),storage.get(journalHeadKey)]);
 const accepted=parse(oldMeta.data);
 req(accepted.version===1&&accepted.binding===roles.previous.binding&&accepted.cursor===roles.previous.cursor&&
   sha(JSON.stringify(accepted))===roles.previous.sha256,'old_accepted_replica_manifest_changed');
 const input={pinWire:pin.data,snapshotConfigWire,candidateManifestWire:candidateMeta.data,journalHeadWire:journalMeta.data,attested:authMeta};
 const {manifest,journal}=exactV4SealedReadPlan(input);exactPlanStats(manifest,journal);
 for(const [i,obj] of manifest.parts.entries())storage.authorize(roles.candidateRoot+'/'+i+'.gz','candidate',1,Math.min(17*M,obj.bytes+65536));
 for(const obj of journal.chunks)storage.authorize(roles.journalRoot+'/'+obj.id+'.json','journal',1,Math.min(64*M,journal.bytes));
 const work=await fs.mkdtemp(path.join(scratch,'china-v4-custody-'));
 const filename=path.join(work,'inventory.sqlite');
 try{
  diagnostic.phase='verified_candidate_hydration';
  await hydrateCandidate({storage,manifest,root:roles.candidateRoot,filename});
  req(storage.stats().candidateBytes===budget.encodedCandidateBytes,'compressed_terminal_wire_total_changed');
  diagnostic.phase='authenticated_ordered_journal_and_sqlite_integrity';
  const result=await inspectExactV4Custody({...input,localCandidateReplica:filename,readLocalJournalChunk:async id=>
   (await storage.get(roles.journalRoot+'/'+id+'.json')).data});
  diagnostic.phase='signed_final_read_only_fence';
  const [finalControl,finalPin,finalM,finalJ]=await Promise.all([storage.get(ROOT_CONTROL),storage.get(PIN),storage.get(manifestKey),storage.get(journalHeadKey)]);
  checkPublic(finalControl);reqMeta(finalPin,pinSha,'old_custody_pin_changed_after');
  req(finalPin.etagSha256===pin.etagSha256&&finalM.etagSha256===candidateMeta.etagSha256&&finalJ.etagSha256===journalMeta.etagSha256&&
    finalM.sha256===candidateMeta.sha256&&finalJ.sha256===journalMeta.sha256,'exact_body_scope_changed');
  const c=storage.stats();
  req(c.metadata===budget.metadataGets&&c.candidate===budget.candidateParts&&c.journal===budget.journalChunks&&c.journalBytes===journal.bytes,'body_scope_exact_totals');
  diagnostic.phase='verified_read_only_custody';
  return {status:'candidate_full_body_forensic_custody_only',metadataProofJob:'136466951375',...result.receipt,authenticatedReads:c,
    existingAcceptedBaseRead:'manifest_only',oldAcceptedBaseIndependentReplay:false,localTypedPrivateRowsUploaded:false};
 }finally{await fs.rm(work,{recursive:true,force:true});}
}
export const rehearseBoundedPort=makePort;
export const rehearsePrivateHydration=hydrateCandidate;
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const diagnostic={phase:'preflight'};
 try{
  req(process.argv[2]==='--signed-read-only-custody'&&process.argv.length===5,'explicit_authorized_carrier_required');
  console.log(JSON.stringify(await runExactReadOnlyCustody({scratch:process.argv[3],snapshotConfigFile:process.argv[4],diagnostic})));
 }catch(e){
  const reason=typeof e.message==='string'&&/^(?:china_v4_(?:body|custody)_[a-z_]{1,110}|auto_api_detail_404_unresolved)$/.test(e.message)?e.message:'bounded_custody_failed';
  console.log(JSON.stringify({status:'held',reason,phase:diagnostic.phase,authenticatedReads:diagnostic.stats?.()??{},providerRequests:0,storageWrites:0,
    sourceCompletenessAdmissionsAuthorized:false,publicationAuthorized:false,cursorAdvanced:false}));
  process.exitCode=2;
 }
}
