// Invoked only from the reviewed one-shot factory workflow. Never a public API.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,createHmac} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {materializeBoundSource} from './scoped-runtime.mjs';
import {archiveAndConvert} from './archive-stage.mjs';
import {createLargeSourceReader} from './source-read-port.mjs';
import {createScratchMeter} from './scratch-budget.mjs';
import {guard as need,digest,OLD_BASE,REV5,CALC,WORKER_CALC} from '../rev5-successor-core.mjs';
const folder=path.dirname(fileURLToPath(import.meta.url)),oper=path.dirname(folder),H=/^[a-f0-9]{64}$/,S=/^[a-f0-9]{40}$/;
const WF='.github/workflows/china-rev5-source-stage-v2.yml';
const JOB='Prepare full fresh China with one frozen quote';
const APP='1c5f8f6af60f35c3b8cf91ef524d05a454bfcee7',NATIVE='bb6317bffd1f7b1832681ac78378fe6c3e39e3b5',MODELS='83ff17075e9188dcf227c8752dc064248d5f42e0';
const REG={endpoint:'https://s3.regru.cloud',bucket:'avtocena-staging-8120751',prefix:'migration-staging/full-20261011',region:'us-east-1'};
const PLAN='.github/operations/china-rev5-source-stage-v2/';
const MARK='.github/market-runs/china-rev5-source-stage-v2.sha256';
const JOB_TITLE='Prepare verified China source using bounded reads';
const sha=b=>createHash('sha256').update(b).digest('hex'),hmac=(k,s)=>createHmac('sha256',k).update(s).digest();
const safe=x=>x.split('/').every(i=>i.length&&i!=='.'&&i!=='..'&&/^[a-zA-Z0-9_.-]+$/.test(i));
const real=(dir,...args)=>execFileSync('git',['-C',dir,...args],{encoding:'utf8',maxBuffer:1024*1024}).trim();
const j=b=>JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(b));
const read=async(file,cap)=>{const st=await fs.lstat(file);need(st.isFile()&&!st.isSymbolicLink()&&st.size>0&&st.size<=cap&&await fs.realpath(file)===file,'protected_file_bounds');return fs.readFile(file);};
async function boundedResponse(r,cap){
 need(r.status===200&&r.body&&!r.headers.get('content-encoding'),'bounded_official_http');
 const chunks=[];let n=0;
 for await(const b of r.body){need((n+=b.length)<=cap,'official_response_cap');chunks.push(b);}
 return Buffer.concat(chunks,n);
}
function checkMaterialPlan(p){
 need(p?.version===1&&p.kind==='china-rev5-source-stage-v2'&&p.expectedControlSha256===REV5&&p.expectedBaseSha256===OLD_BASE&&
  p.noPublication===true&&p.noCursorWrite===true&&p.noIngress===true&&p.privateArchiveAuthorized===true&&p.privateReadyAuthorized===true&&
  p.producer?.receiptClass==='completedSuccess'&&H.test(p.producer.officialReceiptSha256??'')&&p.producer.conservativeSourceDeadline>Date.now()&&
  H.test(p.workerClosureSha256)&&H.test(p.opsCodeSha256)&&H.test(p.workflowSha256)&&H.test(p.authorizedScopeSha256)&&
  Number.isSafeInteger(p.producer.preflightDeadline)&&p.producer.preflightDeadline<=p.producer.conservativeSourceDeadline&&
  Number.isSafeInteger(p.privateStageBudgetMinutes)&&p.privateStageBudgetMinutes>=110&&p.privateStageBudgetMinutes<=175&&
  p.minRows===100000&&p.maxPrivateArtifactBytes===20*1024**3,'armed_material_plan');
}
function signedFixedControl(cred,fetchImpl){
 const fixed='/'+REG.bucket+'/'+REG.prefix+'/catalog/independent-market-public-v1/china/control.json';
 return async()=>{
  const ts=new Date().toISOString().replace(/[:-]|\.\d{3}/g,''),day=ts.slice(0,8),scope=day+'/'+REG.region+'/s3/aws4_request';
  const headers={host:'s3.regru.cloud','x-amz-content-sha256':sha(''),'x-amz-date':ts},keys=Object.keys(headers).sort().join(';');
  const request=['GET',fixed,'',Object.keys(headers).sort().map(k=>k+':'+headers[k]+'\n').join(''),keys,sha('')].join('\n');
  const sign=hmac(hmac(hmac(hmac('AWS4'+cred.secret,day),REG.region),'s3'),'aws4_request');
  headers.authorization='AWS4-HMAC-SHA256 Credential='+cred.access+'/'+scope+', SignedHeaders='+keys+', Signature='+
    createHmac('sha256',sign).update(['AWS4-HMAC-SHA256',ts,scope,sha(request)].join('\n')).digest('hex');
  const r=await fetchImpl(REG.endpoint+fixed,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(12000)});
  const etag=r.headers.get('etag');need(etag&&etag.length<=256&&!/[\r\n]/.test(etag),'native_opaque_etag');
  const data=await boundedResponse(r,32*1024);return {data,etag,checksum:sha(data)};
 };
}
async function attestProtected({actor,approvedSha,token,fetchImpl}){
 const e=process.env,head=e.GITHUB_SHA,rid=e.GITHUB_RUN_ID;
 need(S.test(head)&&/^[1-9][0-9]{0,19}$/.test(rid)&&e.GITHUB_REPOSITORY==='jeep-jim/AvtoCena'&&e.GITHUB_REPOSITORY_ID==='1289722938'&&
  e.GITHUB_RUN_ATTEMPT==='1'&&e.GITHUB_REF==='refs/heads/main'&&e.GITHUB_JOB==='prepare'&&e.GITHUB_WORKFLOW_REF==='jeep-jim/AvtoCena/'+WF+'@refs/heads/main'&&
  typeof token==='string'&&token.length>10&&token.length<=1024&&!/[\r\n]/.test(token),'github_owner_job');
 const parent=real(actor,'rev-parse','HEAD^'),diff=real(actor,'diff-tree','--no-commit-id','--name-status','-r','HEAD');
 need(real(actor,'rev-parse','HEAD')===head&&diff==='A\t'+MARK&&real(actor,'log','-1','--format=%B')===JOB_TITLE&&
  real(actor,'show','HEAD:'+MARK)===approvedSha+'\n'+parent,'sole_owner_marker');
 let last=0;
 return async(force=false)=>{
  if(!force&&Date.now()-last<45_000)return;
  const root='https://api.github.com/repos/jeep-jim/AvtoCena/actions/runs/'+rid;
  const get=async suffix=>j(await boundedResponse(await fetchImpl(root+suffix,{method:'GET',redirect:'error',
   headers:{authorization:'Bearer '+token,accept:'application/json','accept-encoding':'identity'},signal:AbortSignal.timeout(15000)}),1024*1024));
  const [run,jobs]=await Promise.all([get(''),get('/attempts/1/jobs?per_page=100')]),m=jobs.jobs?.filter(k=>k.name===JOB);
  need(String(run.id)===rid&&run.run_attempt===1&&run.head_sha===head&&run.head_branch==='main'&&run.status==='in_progress'&&run.event==='push'&&run.path===WF&&
   run.repository?.id===1289722938&&m?.length===1&&m[0].status==='in_progress'&&m[0].head_sha===head&&String(m[0].run_id)===rid,'active_protected_job');
  last=Date.now();
 };
}
export async function readVerifiedFileManifest(base,manifest){
 const lines=manifest.trim().split('\n'),seen=new Set(),pins=[];
 need(lines.length>0&&lines.length<=400&&path.isAbsolute(base)&&await fs.realpath(base)===base,'sealed_code_inventory');
 for(const line of lines){
  const m=line.match(/^([a-f0-9]{64})  ([-a-zA-Z0-9_./]+)$/),name=m?.[2];
  need(m&&safe(name)&&!seen.has(name),'sealed_code_file');
  seen.add(name);const b=await read(path.join(base,name),32*1024*1024);
  need(sha(b)===m[1],'sealed_code_blob');
  pins.push({file:name,bytes:b.length,sha256:m[1]});
 }
 return pins;
}
export async function runFactory({actor,candidate,native,models,secretFile,scratch,fetchImpl=globalThis.fetch}){
 const e=process.env;
 need(actor===path.resolve(oper,'../../..')&&real(candidate,'rev-parse','HEAD')===APP&&real(native,'rev-parse','HEAD')===NATIVE&&
  real(models,'rev-parse','HEAD')===MODELS&&await fs.realpath(scratch)===scratch&&((await fs.stat(scratch)).mode&0o077)===0,'fixed_checkouts');
 const approvedRaw=await read(path.join(oper,'approved.json'),128*1024),approvedSha=sha(approvedRaw),p=j(approvedRaw);
 checkMaterialPlan(p);
 const scopeWire=await read(path.join(oper,'authorized-private-scope.json'),16*1024),scope=j(scopeWire);
 need(sha(scopeWire)===p.authorizedScopeSha256&&scope?.version===1&&scope.kind==='explicit_private_prepare_only_china'&&
  scope.runId===p.producer.runId&&scope.sourceTerminalSha256===p.producer.officialReceiptSha256&&scope.controlSha256===REV5&&
  scope.privateNativeArchive===true&&scope.privateStageReady===true&&scope.publication===false&&scope.cursorWrite===false&&scope.ingress===false&&scope.providerRequests===false,
  'private_only_exact_owner_scope');
 const workSeal=await read(path.join(oper,'SOURCE_CLOSURE.sha256'),64*1024);
 const runtimeCodeFiles=await readVerifiedFileManifest(candidate,workSeal.toString('utf8'));
 const codeSeal=await read(path.join(oper,'APPROVED_CODE.sha256'),64*1024);
 need(sha(codeSeal)===p.opsCodeSha256&&sha(workSeal)===p.workerClosureSha256&&sha(await read(path.join(actor,WF),128*1024))===p.workflowSha256,
  'exact_reviewed_code_manifest');
 await readVerifiedFileManifest(oper,codeSeal.toString('utf8'));
 const att=await attestProtected({actor,approvedSha,token:e.GITHUB_TOKEN,fetchImpl});await att(true);
 const credentials=await read(secretFile,4096),ss=await fs.lstat(secretFile),cred=j(credentials);
 need((ss.mode&0o077)===0&&ss.nlink===1&&/^[a-zA-Z0-9_+=./-]{1,256}$/.test(cred.access)&&typeof cred.secret==='string'&&
  cred.secret.length>0&&cred.secret.length<=1024&&!/[\r\n]/.test(cred.secret),'existing_stage_role');
 Object.assign(e,{YC_OBJECT_STORAGE_ENDPOINT:REG.endpoint,YC_OBJECT_STORAGE_BUCKET:REG.bucket,YC_OBJECT_STORAGE_PREFIX:REG.prefix,
  YC_OBJECT_STORAGE_REGION:REG.region,YC_OBJECT_STORAGE_ACCESS_KEY_ID:cred.access,YC_OBJECT_STORAGE_SECRET_ACCESS_KEY:cred.secret,JSON_STORAGE_DRIVER:'object'});
 const load=(root,f)=>import(pathToFileURL(path.join(root,f)).href);
 const {ObjectJsonStorage}=await load(candidate,'apps/web/lib/data.ts'),storage=new ObjectJsonStorage();
 // Exact historical prepare job role only. No provider secret or SDK available.
 const expires=Math.min(Date.now()+p.privateStageBudgetMinutes*60_000,p.producer.preflightDeadline);
 const scratchMeter=createScratchMeter(scratch);
 await scratchMeter.check('before_private_source_restore',{force:true,needBytes:9*1024**3});
 const source=await materializeBoundSource({storage,scratch,scratchMeter,snapshotWire:await read(path.join(oper,'original-snapshot.json'),128*1024),
  producer:p.producer,first:p.first,token:e.GITHUB_TOKEN,authorizeCurrentJob:att,readLiveControl:signedFixedControl(cred,fetchImpl),
  largeRead:createLargeSourceReader({cred,fetchImpl,expires}),fetchImpl,expires});
 need(source.result.sourceExpiresAt>=p.producer.conservativeSourceDeadline&&source.result.officialTerminalSha256===p.producer.officialReceiptSha256,'terminal_expiry_proven');
 await fs.unlink(path.join(scratch,'fresh-private-replica.sqlite')); // this execution's consumed scratch copy only
 console.log(JSON.stringify({status:'native_terminal_sealed_local',rawRows:source.result.observations,terminalCursor:source.result.terminalCursor,
  confirmedRemoved:source.result.confirmedLastActionRemoved,providerCalls:0,published:false,cursorMoved:false}));
 const archiveModule=await load(native,'scripts/lib/nonjp-intake-archive.mjs'),converter=await load(native,'scripts/lib/catalog-disk-conversion.mjs');
 const a=await archiveAndConvert({source,original:storage,archiveModule,converter,owner:{runId:e.GITHUB_RUN_ID,attempt:'1',revision:e.GITHUB_SHA},scratch,scratchMeter});
 console.log(JSON.stringify({status:'own_native_input_archive_ready',archiveSha256:a.receipt.manifestSha256,reportSha256:a.receipt.reportDigest,
  rawRows:a.admission.sourceRows,convertedShards:a.admission.shards.length,published:false,cursorMoved:false}));
 const guardRoot=path.join(oper,'guard'),prefix='work/epoch-recovery/fx-inventory-split/archive-stage/';
 const context=path.join(oper,'runtime-context-plan.json'),ctxWire=await read(context,64*1024),ctx=j(ctxWire),time=Date.now();
 need(ctx.releaseSha===MODELS&&ctx.calculationVersion===CALC&&a.sourceSeal.sourceExpiresAt-time>=55*60_000,'native_context_or_no_prepare_headroom');
 const launcher=runtimeCodeFiles.find(x=>x.file==='scripts/catalog-china-rev5-prepare-once.mjs');
 const gf=await readVerifiedFileManifest(guardRoot,(await read(path.join(oper,'GUARD_CLOSURE.sha256'),64*1024)).toString('utf8'));
 need(launcher&&H.test(p.collectorClosureSha256),'original_price_closure');
 const launch={version:1,repository:'jeep-jim/AvtoCena',workflow:WF,job:'prepare',jobDisplayName:JOB,sourceMode:'complete-fresh-replacement',
  canonicalPolicy:'native-public-identity-and-renderable-single-source-v1',collectorClosureSha256:p.collectorClosureSha256,
  archiveReportSha256:a.receipt.reportDigest,archiveManifestSha256:a.receipt.manifestSha256,ownerApprovalSha256:p.authorizedScopeSha256,
  calculationVersion:WORKER_CALC,guardEntryPrefix:prefix,guardFiles:gf,runtimeCodeFiles,runtimeContextPlanSha256:sha(ctxWire),
  runtimeContextReleaseSha:MODELS,runtimeContextCalculationVersion:CALC,blockRows:50,modelScope:{make:'BMW',model:'X3'},
  privateStage:{authorized:true,storage:REG,expectedChinaPublicBaseSha256:OLD_BASE,minAdmittedRows:p.minRows,maxArtifactBytes:p.maxPrivateArtifactBytes},
  launcherSha256:launcher.sha256,authorizedHeadSha:e.GITHUB_SHA,runtimeAuthorityBaseSha:real(actor,'rev-parse','HEAD^'),
  expectedAppHeadSha:APP,composedFromPolicySha256:approvedSha,generationId:'gen_'+time+'_china'+e.GITHUB_RUN_ID,authorizesPublication:false,
  terminalWitnessSha256:a.sourceSeal.officialTerminalSha256,nativeReceiptSha256:a.receiptSha256,nativeAdmissionSha256:a.admissionSha256};
 const raw=Buffer.from(JSON.stringify(launch)),launchFile=path.join(scratch,'launch.json');
 await fs.writeFile(launchFile,raw,{mode:0o600,flag:'wx'});
 const {runChinaFullFreshOneShot}=await load(candidate,launcher.file);
 const receipt=path.join(source.outputRoot,'own-storage-receipt.json');
 const args=['--launch',launchFile,'--expect-launch-sha',sha(raw),'--guard-bundle',guardRoot,'--native-root',native,
  '--receipt',receipt,'--source-secrets',secretFile,'--stage-secrets',secretFile,'--scratch',scratch,'--runtime-context',path.join(scratch,'native-price-context'),
  '--runtime-context-plan',context,'--runtime-context-release-root',models];
 await source.assertLive(true);return runChinaFullFreshOneShot(args,e,a);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const [actor,candidate,native,models,secretFile,scratch]=process.argv.slice(2);need(process.argv.length===8,'exact_local_args');
  await runFactory({actor,candidate,native,models,secretFile,scratch});}
 catch(e){const reason=e?.message??'';
  console.error(JSON.stringify({status:'prepare_only_held',reason:/^(?:china_rev5_successor|china_full_fresh_one_job|china_runtime_context|china_private_stage_privacy):[a-zA-Z0-9_-]{1,96}$/.test(reason)?reason:'native_or_authority_refused',
   publicationAuthorized:false,cursorAdvanceAuthorized:false}));process.exitCode=1;}
}
