// Entrypoint for detached f4dc writer root only. Nothing passes a callback
// until actual source provenance and short-lived 22867 witness are validated.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {runNativeSuccessor} from './native-rev5-successor-adapter.mts';
import {holdOwnerHostLease} from './host-lease.mjs';
import {acceptChinaPublic,assertPublicInstalledChinaRuntime} from './public-acceptance.mjs';
const runExec=promisify(execFile), sha=(x:Buffer)=>createHash('sha256').update(x).digest('hex');
const H=/^[a-f0-9]{64}$/,G=/^[a-f0-9]{40}$/,N=/^[1-9]\d{0,19}$/;
const workflow='.github/workflows/china-rev5-own-cut-once.yml',marker='.github/market-runs/china-rev5-own-cut-once.sha256';
const title='Activate exactly one prepared China cut without deployment';
const root=process.env.GITHUB_WORKSPACE??'', job=process.env.GITHUB_RUN_ID??'', head=process.env.GITHUB_SHA??'', token=process.env.GITHUB_TOKEN??'';
const need=(v:unknown,k:string)=>{if(!v)throw Error('china_cut_actor:'+k)};
const git=(...a:string[])=>execFileSync('/usr/bin/git',a,{cwd:root,timeout:10000,maxBuffer:128*1024,encoding:'buffer'});
async function read(file:string,cap=65536){
 const fd=await fs.open(file,'r');try{const st=await fd.stat();need(st.isFile()&&st.size>0&&st.size<=cap,'local_material_bound');
  const b=await fd.readFile();need(b.length===st.size&&await fs.realpath(file)===file,'local_material_identity');return b;
 }finally{await fd.close();}
}
async function gh(pathname:string){
 const r=await fetch('https://api.github.com/repos/jeep-jim/AvtoCena/actions/'+pathname,{method:'GET',redirect:'error',
  signal:AbortSignal.timeout(10000),headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json'}});
 need(r.status===200&&r.body,'actions_metadata');
 let n=0;const parts:Buffer[]=[];for await(const b of r.body!){n+=b.length;need(n<=512*1024,'actions_metadata_bytes');parts.push(Buffer.from(b));}
 return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
let didAttempt=false;
try{
 const [approvedFile,authorityFile,preview,removalPreview,scopePrivateKey,knownHosts,leaseScript,secretScratch]=process.argv.slice(2);
 need(process.argv.length===10&&G.test(head)&&N.test(job)&&/^ghs_[A-Za-z0-9_.-]{10,4092}$/.test(token)&&
  process.env.GITHUB_REPOSITORY==='jeep-jim/AvtoCena'&&process.env.GITHUB_REPOSITORY_ID==='1289722938'&&
  process.env.GITHUB_REF==='refs/heads/main'&&process.env.GITHUB_EVENT_NAME==='push'&&process.env.GITHUB_RUN_ATTEMPT==='1'&&
  process.env.GITHUB_JOB==='activate'&&process.env.GITHUB_WORKFLOW_REF==='jeep-jim/AvtoCena/'+workflow+'@refs/heads/main','action_identity');
 const approval=await read(approvedFile),plan=JSON.parse(approval.toString()),approvalSha=sha(approval);
 const author=await read(authorityFile),a=JSON.parse(author.toString()),authSha=sha(author);
 const parent=git('rev-parse','HEAD^').toString().trim();
 need(git('rev-parse','HEAD').toString().trim()===head&&G.test(parent)&&
  git('diff-tree','--no-commit-id','-r','--name-status','--no-renames','-z','HEAD^','HEAD').equals(Buffer.from('A\0'+marker+'\0'))&&
  git('show','HEAD:'+marker).toString()===approvalSha+'\n'+parent+'\n'+sha(await read(path.join(path.dirname(approvedFile),'APPROVED_CODE.sha256')))+'\n'&&authSha===plan.authorizationSha256,'sole_approved_marker');
 need(a?.version===1&&a.kind==='china-one-cut-execution-v1'&&a.onlyIndependentChinaControl===true&&a.noCursorWrite===true&&
  H.test(a.previewSha256??'')&&H.test(a.removalPreviewSha256??'')&&H.test(a.workflowSha256??'')&&
  H.test(a.leaseScriptSha256??'')&&H.test(a.knownHostsSha256??'')&&
  sha(git('show','HEAD:'+workflow))===a.workflowSha256&&sha(await read(leaseScript,8192))===a.leaseScriptSha256&&
  sha(await read(knownHosts,8192))===a.knownHostsSha256&&sha(await read(preview,32*1024**2))===a.previewSha256&&
  sha(await read(removalPreview,8*1024**2))===a.removalPreviewSha256&&
  a.preparedProof?.sourceTerminalReceiptSha256===plan.source?.terminalWitnessSha256&&
  a.preparedProof?.archiveSha256===plan.source?.archiveSha256&&a.preparedProof?.readySha256===plan.target?.readySha256&&
  H.test(a.preparedProof?.withdrawalWitnessSha256??'')&&
  N.test(a.preparedProof?.runId??'')&&G.test(a.preparedProof?.headSha??'')&&N.test(a.preparedProof?.jobId??'')&&
  /^\.github\/workflows\/[a-z0-9-]+\.yml$/.test(a.preparedProof?.workflow??''),'closure_or_native_material');
 const challenge=async()=>{
  const r=await gh('runs/'+job);
  need(String(r.id)===job&&r.head_sha===head&&r.head_branch==='main'&&r.path===workflow&&r.run_attempt===1&&
    r.event==='push'&&r.status==='in_progress'&&r.head_commit?.message===title&&String(r.repository?.id)==='1289722938','actions_run_changed');
 };
 const prepared=async()=>{
  const q=a.preparedProof,[r,j]=await Promise.all([gh('runs/'+q.runId),gh('jobs/'+q.jobId)]);
  need(String(r.id)===q.runId&&r.head_sha===q.headSha&&r.path===q.workflow&&r.run_attempt===1&&r.status==='completed'&&r.conclusion==='success'&&
    String(r.repository?.id)==='1289722938'&&String(j.id)===q.jobId&&String(j.run_id)===q.runId&&j.head_sha===q.headSha&&j.conclusion==='success','prepared_producer_not_authenticated');
 };
 await challenge();await prepared();
 const lease=await holdOwnerHostLease({identityFile:scopePrivateKey,knownHostsFile:knownHosts,leaseScript});
 let previewReceipt:any,withdrawal:any;
 const op=path.dirname(approvedFile);
 need(secretScratch.startsWith((process.env.RUNNER_TEMP??'')+'/china-cut-private.')&&await fs.realpath(secretScratch)===secretScratch&&
  ((await fs.stat(secretScratch)).mode&0o077)===0,'private_probe_scratch');
 const readerEnv=(enabled:string)=>({PATH:'/usr/bin:/bin',...Object.fromEntries(['JSON_STORAGE_DRIVER','YC_OBJECT_STORAGE_ENDPOINT','YC_OBJECT_STORAGE_BUCKET',
 'YC_OBJECT_STORAGE_PREFIX','YC_OBJECT_STORAGE_REGION','YC_OBJECT_STORAGE_ACCESS_KEY_ID','YC_OBJECT_STORAGE_SECRET_ACCESS_KEY'].map(k=>[k,process.env[k]])),
 AVTOCENA_RELEASE_SHA:plan.release,AVTOCENA_CALCULATION_VERSION:plan.calculationVersion,AVTOCENA_CHINA_REGCLOUD_RUNTIME:enabled});
 try{
  const out=await runNativeSuccessor({approval,sha256:approvalSha,action:'activate',authority:{
   async assertApprovedMainRunAnd22867Lease(p){
     need(p.approvedSha256===approvalSha&&p.authorizationSha256===authSha,'approval_changed');
     await challenge();await lease.assertCurrent();await assertPublicInstalledChinaRuntime();
   },
   assertFreshSourceReceiptAndArchiveApproved:prepared,
   async runPinned22867NativePreview(p){
    await lease.assertCurrent();await p.assertCurrent();
    need(sha(await read(preview,8*1024**2))===a.previewSha256&&
      sha(await read(removalPreview,8*1024**2))===a.removalPreviewSha256,'preview_changed');
    const negative=await runExec(process.execPath,[removalPreview],{timeout:65000,maxBuffer:8192,env:readerEnv('1')});
    const w=Buffer.from(negative.stdout);withdrawal=JSON.parse(negative.stdout);
    need(sha(w)===a.preparedProof.withdrawalWitnessSha256&&withdrawal.matchesUserFord===true&&
      /^[a-f0-9]{24}$/.test(withdrawal.stableOfferId)&&withdrawal.explicitRemoved===true&&withdrawal.presentAtTerminal===false,
      'exact_withdrawal_drift');
    const witnessFile=path.join(secretScratch,'withdrawal.json'),previewGrant=path.join(secretScratch,'grant.json');
    await fs.writeFile(witnessFile,w,{mode:0o600,flag:'wx'});
    const grant=await runExec('/usr/bin/python3',[path.join(op,'make-preview-grant.py'),'--withdrawal-proof',witnessFile,
      '--expected-withdrawal-sha256',a.preparedProof.withdrawalWitnessSha256,'--output',previewGrant],{timeout:7000,maxBuffer:1024,env:{PATH:'/usr/bin:/bin'}});
    const grantSha=grant.stdout.trim();
    need(H.test(grantSha)&&sha(await read(previewGrant,8192))===grantSha,'same_session_grant');
    const {stdout}=await runExec(process.execPath,[preview,previewGrant,grantSha],{timeout:100000,maxBuffer:8192,env:readerEnv('0')});
    const x=JSON.parse(stdout);
    need(x.kind==='private-china-candidate-readback'&&x.buildSha256==='8a7326fc17de9a28ae66a4915e68038ac089ba4cdf2954bd7fcbd7cbda46ccf8'&&
      x.readySha256===p.readySha256&&x.generationId===p.generationId&&typeof x.canonicalCardUri==='string'&&x.removedOfferAbsent===true&&x.knownRemovedId===withdrawal.stableOfferId&&
      x.source?.receiptSha256===plan.source.sourceReceiptSha256&&x.source?.cursor===plan.source.cursor&&
      x.source?.replicaSha256===plan.source.replicaSha256&&x.source?.observedAt===plan.source.observedAt&&
      x.source?.validUntil===plan.source.validUntil,'native_reader_witness');
    await p.assertCurrent();await lease.assertCurrent();
    previewReceipt={...x,runtimeRelease:plan.release};
    return previewReceipt;
   },
  }});
  didAttempt=true;
  console.log(JSON.stringify(out));
  const attestation=await acceptChinaPublic({generation:plan.target.generationId,readyRows:plan.ready.admittedRows,
   knownRemovedId:withdrawal.stableOfferId,knownRemovedCanonicalPath:withdrawal.knownRemovedCanonicalPath,
   make:a.previewMake,model:a.previewModel,anchor:previewReceipt,assertCurrent:async()=>{await challenge();await lease.assertCurrent();}});
  console.log(JSON.stringify(attestation));
 }finally{lease.close();}
}catch(e){
 const s=e instanceof Error?e.message:'';
 console.error(JSON.stringify({status:didAttempt?'china_control_written_public_acceptance_unverified':'china_control_attempt_not_verified_reconcile_before_any_retry',
  reason:/^(?:china_[a-z_]+|host_lease_[a-z_]+)(?::[a-z_0-9]+)?$/.test(s)?s:'cut_actor_held',cursorAdvanced:false}));
 process.exitCode=2;
}
