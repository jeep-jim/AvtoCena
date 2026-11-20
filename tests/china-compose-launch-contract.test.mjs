import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {composeChinaLaunch} from '../scripts/catalog-china-compose-launch-contract.mjs';
const repo='jeep-jim/AvtoCena',wf='.github/workflows/china-full-fresh-prepare-v1.yml',job='Prepare full fresh China with one frozen quote';
const launcher='scripts/catalog-china-full-fresh-one-shot.mjs',hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'china-compose-launch-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const git=async(...args)=>(await promisify(execFile)('git',args,{cwd:root})).stdout.trim();
 await git('init','-q');await git('config','user.name','Fixture');await git('config','user.email','fixture@example.test');
 await git('commit','--allow-empty','-qm','Reviewed ancestor');
 const priorAuthorityCommit=await git('rev-parse','HEAD');
 const runtimeCodeFiles=[];
 for(const [file,value]of [[wf,'name: candidate-only'],[launcher,'// one-shot fixture']]){
  const resolved=path.join(root,file);await fs.mkdir(path.dirname(resolved),{recursive:true});
  await fs.writeFile(resolved,value);runtimeCodeFiles.push({file,bytes:Buffer.byteLength(value),sha256:hash(value)});
 }
 await git('add','.');await git('commit','-qm','Actual guarded actor');
 const head=await git('rev-parse','HEAD'),ref='refs/heads/main',id='93';
 const env={GITHUB_REPOSITORY:repo,GITHUB_REPOSITORY_ID:'1289722938',GITHUB_REF:ref,GITHUB_WORKFLOW_REF:repo+'/'+wf+'@'+ref,
  GITHUB_JOB:'prepare',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:id,GITHUB_SHA:head,GITHUB_TOKEN:'github-token-fixture-for-test'};
 const p={version:1,kind:'china-owner-preapproved-private-stage-v1',repository:repo,workflow:wf,job:'prepare',authorizesPublication:false,
  authorizesCursorAdvance:false,priorAuthorityCommit,plan:{authorizesPublication:false,sourceMode:'complete-fresh-replacement',
   collectorClosureSha256:'87c2063055d77cce8f4c639cd10ddec3d333295531235351d379a9d2d8321c22',
   privateStage:{authorized:true,storage:{endpoint:'https://s3.regru.cloud',bucket:'avtocena-staging-8120751',prefix:'migration-staging/full-20261011',region:'us-east-1'},
    expectedChinaPublicBaseSha256:'a'.repeat(64)},ownerApprovalSha256:'a'.repeat(64),archiveReportSha256:'a'.repeat(64),
   archiveManifestSha256:'a'.repeat(64),calculationVersion:'a'.repeat(64),runtimeContextPlanSha256:'a'.repeat(64),runtimeCodeFiles}};
 const approvedBytes=Buffer.from(JSON.stringify(p)),out=path.join(root,'launch.json'),calls=[];
 const fetchImpl=async(u,init)=>{
  assert.match(u,/^https:\/\/api.github.com\/repos\/jeep-jim\/AvtoCena\/actions\/runs\/93(?:$|\/)/);
  assert.equal(init.method,'GET');assert.equal(init.redirect,'error');calls.push(u);
  if(u.includes('/jobs'))return Response.json({total_count:1,jobs:[{name:job,status:'in_progress',run_id:93,head_sha:head}]});
  return Response.json({id:93,run_attempt:1,head_sha:head,head_branch:'main',path:wf,repository:{id:1289722938,full_name:repo},event:'push',status:'in_progress'});
 };
 return {p,calls,args:{approvedBytes,approvedSha256:hash(approvedBytes),out,env,root,fetchImpl,now:()=>1790000000000}};
}
test('compose binds prior approved policy, exact code and currently authenticated workflow without embedding its own head',async t=>{
 const {args,p,calls}=await fixture(t),valid=await composeChinaLaunch(args);
 const raw=await fs.readFile(args.out),plan=JSON.parse(raw);
 assert.equal(hash(raw),valid.launchSha256);assert.equal(plan.authorizedHeadSha,args.env.GITHUB_SHA);
 assert.equal(plan.runtimeAuthorityBaseSha,p.priorAuthorityCommit);assert.equal(plan.generationId,'gen_1790000000000_china93');
 assert.equal(plan.authorizesPublication,false);assert.equal(calls.length,2);
});
test('changed code or inactive actor never creates a private stage permit',async t=>{
 const f=await fixture(t);
 await assert.rejects(composeChinaLaunch({...f.args,fetchImpl:async(u,i)=>u.includes('/jobs')?
  Response.json({total_count:0,jobs:[]}):f.args.fetchImpl(u,i)}),/github_job_refused/);
 await fs.appendFile(path.join(f.args.root,launcher),' tamper ');
 await assert.rejects(composeChinaLaunch(f.args),/runtime_file_pin/);
 await assert.rejects(fs.stat(f.args.out),{code:'ENOENT'});
});
