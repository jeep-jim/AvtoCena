#!/usr/bin/env node
/** Bind already approved static actor evidence to the actually running job.
 * This writes only an exclusive local launch file and does not grant access. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {parseArgs,promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
const WORKFLOW='.github/workflows/china-full-fresh-prepare-v1.yml';
const REPO='jeep-jim/AvtoCena',REPO_ID='1289722938',JOB='Prepare full fresh China with one frozen quote';
const COLLECTOR='87c2063055d77cce8f4c639cd10ddec3d333295531235351d379a9d2d8321c22';
const SHA=/^[a-f0-9]{64}$/,REL=/^[a-f0-9]{40}$/,RUN=/^[1-9][0-9]{0,19}$/;
const hash=b=>createHash('sha256').update(b).digest('hex');
const need=(v,k)=>{if(!v)throw Error('china_launch_composer:'+k);};
const parse=b=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
const clock=()=>Date.now();
const ROOT=path.resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const CANDIDATE='40e86a1bd28ca5759ac00cd09f665a45f66afb0a',CANDIDATE_PARENT='5a254a3dce9993fca726471866eee614ddebfd0a';
const ops='.github/operations/china-full-fresh-v1';
const launcher='scripts/catalog-china-full-fresh-one-shot.mjs';
const storage={endpoint:'https://s3.regru.cloud',bucket:'avtocena-staging-8120751',prefix:'migration-staging/full-20261011',region:'us-east-1'};
const safe=x=>x!=='.'&&x!=='..'&&/^[a-zA-Z0-9_.-]+$/.test(x);
function envBinding(e){
 need(e.GITHUB_REPOSITORY===REPO&&e.GITHUB_REPOSITORY_ID===REPO_ID&&e.GITHUB_REF==='refs/heads/main'&&
  e.GITHUB_WORKFLOW_REF===REPO+'/'+WORKFLOW+'@refs/heads/main'&&e.GITHUB_JOB==='prepare'&&e.GITHUB_RUN_ATTEMPT==='1'&&
  RUN.test(e.GITHUB_RUN_ID??'')&&REL.test(e.GITHUB_SHA??'')&&
  typeof e.GITHUB_TOKEN==='string'&&e.GITHUB_TOKEN.length>10&&e.GITHUB_TOKEN.length<=1024&&!/[\r\n\x00]/.test(e.GITHUB_TOKEN),'github_environment');
}
async function authenticate(env,fetchImpl){
 envBinding(env);
 const endpoint='https://api.github.com/repos/'+REPO+'/actions/runs/'+env.GITHUB_RUN_ID;
 const read=async suffix=>{
  const r=await fetchImpl(endpoint+suffix,{method:'GET',redirect:'error',headers:{authorization:'Bearer '+env.GITHUB_TOKEN,
   accept:'application/vnd.github+json','accept-encoding':'identity'},signal:AbortSignal.timeout(15000)});
  if(r.status!==200||r.headers.get('content-encoding')||!r.body){await r.body?.cancel();need(false,'github_read');}
  const chunks=[];let bytes=0;
  for await(const chunk of r.body){bytes+=chunk.length;need(bytes<=1024*1024,'github_read_bound');chunks.push(chunk);}
  return parse(Buffer.concat(chunks,bytes));
 };
 const [run,jobs]=await Promise.all([read(''),read('/attempts/1/jobs?per_page=100')]);
 const eligible=jobs.jobs?.filter(j=>j.name===JOB);
 need(String(run.id)===env.GITHUB_RUN_ID&&run.run_attempt===1&&run.head_sha===env.GITHUB_SHA&&run.head_branch==='main'&&run.path===WORKFLOW&&
  String(run.repository?.id)===REPO_ID&&run.repository?.full_name===REPO&&run.event==='push'&&run.status==='in_progress'&&
  Number.isSafeInteger(jobs.total_count)&&jobs.total_count===jobs.jobs?.length&&jobs.total_count<=100&&
  eligible?.length===1&&eligible[0].status==='in_progress'&&String(eligible[0].run_id)===env.GITHUB_RUN_ID&&eligible[0].head_sha===env.GITHUB_SHA,'github_job_refused');
}
export async function composeChinaLaunch({approvedBytes,approvedSha256,out,env=process.env,root=ROOT,candidateRoot,fetchImpl=globalThis.fetch,now=clock}){
 need(Buffer.isBuffer(approvedBytes)&&approvedBytes.length<=128*1024&&SHA.test(approvedSha256??'')&&hash(approvedBytes)===approvedSha256,'approved_bytes');
 envBinding(env);
 const approved=parse(approvedBytes),p=approved.plan;
 need(approved?.version===1&&approved.kind==='china-owner-preapproved-private-stage-v1'&&approved.repository===REPO&&
  approved.workflow===WORKFLOW&&approved.job==='prepare'&&approved.authorizesPublication===false&&approved.authorizesCursorAdvance===false&&
  REL.test(approved.priorAuthorityCommit??'')&&approved.priorAuthorityCommit!==env.GITHUB_SHA&&approved.candidateAppCommit===CANDIDATE&&
  Array.isArray(approved.workflowCodeFiles)&&approved.workflowCodeFiles.length===4&&
  p&&p.authorizesPublication===false&&p.sourceMode==='complete-fresh-replacement'&&p.collectorClosureSha256===COLLECTOR&&
  p.privateStage?.authorized===true&&Object.entries(storage).every(([k,v])=>p.privateStage.storage?.[k]===v)&&
  [p.ownerApprovalSha256,p.archiveReportSha256,p.archiveManifestSha256,p.calculationVersion,p.runtimeContextPlanSha256,
   p.privateStage.expectedChinaPublicBaseSha256].every(x=>SHA.test(x??''))&&Array.isArray(p.runtimeCodeFiles)&&p.runtimeCodeFiles.length<=1000&&
  !p.authorizedHeadSha&&!p.launcherSha256&&!p.generationId&&!p.runtimeDataFiles,'policy_scope');
 need(path.isAbsolute(root)&&path.normalize(root)===root&&await fs.realpath(root)===root&&path.isAbsolute(candidateRoot)&&
  path.normalize(candidateRoot)===candidateRoot&&await fs.realpath(candidateRoot)===candidateRoot&&root!==candidateRoot&&
  !root.startsWith(candidateRoot+path.sep)&&!candidateRoot.startsWith(root+path.sep)&&path.isAbsolute(out)&&path.normalize(out)===out&&
  await fs.realpath(path.dirname(out))===path.dirname(out),'paths');
 const git=async(dir,...a)=>(await promisify(execFile)('git',a,{cwd:dir,maxBuffer:16*1024})).stdout.trim();
 need(await git(root,'rev-parse','HEAD')===env.GITHUB_SHA&&
  await git(candidateRoot,'rev-parse','HEAD')===CANDIDATE&&
  await git(candidateRoot,'rev-parse','HEAD^')===CANDIDATE_PARENT,'actual_checkout');
 await git(root,'merge-base','--is-ancestor',approved.priorAuthorityCommit,env.GITHUB_SHA);
 const launcherPin=p.runtimeCodeFiles.find(x=>x?.file===launcher),workflowPin=approved.workflowCodeFiles.find(x=>x?.file===WORKFLOW);
 need(launcherPin&&workflowPin&&[ops+'/compose-split-launch-contract.mjs',ops+'/verify-collector-receipt.py',ops+'/runtime-context-plan.json']
  .every(file=>approved.workflowCodeFiles.some(x=>x?.file===file)),'required_code_pins');
 async function verify(dir,pins){
  const seen=new Set();
  for(const x of pins){
   need(typeof x?.file==='string'&&x.file.split('/').every(safe)&&!seen.has(x.file)&&SHA.test(x.sha256??'')&&
    Number.isSafeInteger(x.bytes)&&x.bytes>0&&x.bytes<=32*1024*1024,'runtime_pin');
   const file=path.join(dir,x.file),st=await fs.lstat(file);
   need(st.isFile()&&st.size===x.bytes&&await fs.realpath(file)===file&&hash(await fs.readFile(file))===x.sha256,'runtime_file_pin');
   seen.add(x.file);
  }
 }
 await verify(root,approved.workflowCodeFiles);
 await verify(candidateRoot,p.runtimeCodeFiles);
 const contextPin=approved.workflowCodeFiles.find(x=>x.file===ops+'/runtime-context-plan.json');
 need(contextPin.sha256===p.runtimeContextPlanSha256,'runtime_context_pin');
 await authenticate(env,fetchImpl);
 const ms=now();need(Number.isSafeInteger(ms)&&/^\d{13}$/.test(String(ms)),'clock');
 const launch={...p,version:1,repository:REPO,workflow:WORKFLOW,job:'prepare',jobDisplayName:JOB,launcherSha256:launcherPin.sha256,
  authorizedHeadSha:env.GITHUB_SHA,runtimeAuthorityBaseSha:approved.priorAuthorityCommit,generationId:'gen_'+ms+'_china'+env.GITHUB_RUN_ID,
  expectedAppHeadSha:CANDIDATE,composedFromPolicySha256:approvedSha256,authorizesPublication:false};
 const bytes=Buffer.from(JSON.stringify(launch));
 need(bytes.length<=128*1024,'output_limit');
 await fs.writeFile(out,bytes,{flag:'wx',mode:0o600});
 need(hash(await fs.readFile(out))===hash(bytes),'launch_readback');
 return {launchSha256:hash(bytes),approvedSha256,jobRunId:env.GITHUB_RUN_ID,generationId:launch.generationId,publicationAuthorized:false};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{
  const {values}=parseArgs({options:{approved:{type:'string'},'expect-approved-sha':{type:'string'},out:{type:'string'},'candidate-root':{type:'string'}}});
  need(typeof values.approved==='string'&&SHA.test(values['expect-approved-sha']??'')&&typeof values.out==='string'&&typeof values['candidate-root']==='string','args');
  const file=path.resolve(values.approved),st=await fs.lstat(file);
  need(st.isFile()&&st.size>0&&st.size<=128*1024&&await fs.realpath(file)===file,'approved_file');
  const result=await composeChinaLaunch({approvedBytes:await fs.readFile(file),approvedSha256:values['expect-approved-sha'],out:path.resolve(values.out),candidateRoot:path.resolve(values['candidate-root'])});
  console.log(JSON.stringify(result));
 }catch(error){console.error(JSON.stringify({status:'not_composed',reason:/^china_launch_composer:[a-z0-9_]+$/.test(error?.message??'')?error.message:'identity_or_pin_refused'}));process.exitCode=1;}
}
