import {isCleanSnapshotProof} from './clean-snapshot-admission.mjs';
import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
const need=(v,c)=>{if(!v)throw Error('china_fresh_fx_owner_'+c);};
const root='https://api.github.com/repos/jeep-jim/AvtoCena/actions/runs/';
const workflow='.github/workflows/china-rev5-source-stage-v3.yml';
export async function authenticateFreshFxOwner({env=process.env,launchContract,expectedLaunchSha256,launcherBytes,proof,assertSourceCurrent,now=Date.now,fetchImpl=globalThis.fetch}={}){
 need(typeof assertSourceCurrent==='function'&&Buffer.isBuffer(launchContract)&&launchContract.length<=128*1024&&sha(launchContract)===expectedLaunchSha256&&
  isCleanSnapshotProof(proof)&&proof?.kind==='china-full-fresh-source-admission-only'&&proof.oldRowsMerged===false&&proof.priced===false&&proof.publicationAuthorized===false,'contract');
 const p=JSON.parse(launchContract.toString());
 need(p?.version===1&&p.repository==='jeep-jim/AvtoCena'&&p.workflow===workflow&&p.job==='prepare'&&p.jobDisplayName==='Prepare full fresh China with one frozen quote'&&
  Buffer.isBuffer(launcherBytes)&&launcherBytes.length<=128*1024&&sha(launcherBytes)===p.launcherSha256&&p.archiveReportSha256===proof.sourceReportSha256&&p.archiveManifestSha256===proof.archiveManifestSha256&&p.authorizesPublication===false,'contract_binding');
 const token=env.GITHUB_TOKEN,id=env.GITHUB_RUN_ID,head=env.GITHUB_SHA;
 need(env.GITHUB_JOB==='prepare'&&env.GITHUB_REPOSITORY==='jeep-jim/AvtoCena'&&env.GITHUB_REPOSITORY_ID==='1289722938'&&env.GITHUB_RUN_ATTEMPT==='1'&&
  env.GITHUB_REF==='refs/heads/main'&&env.GITHUB_WORKFLOW_REF==='jeep-jim/AvtoCena/'+workflow+'@refs/heads/main'&&/^[1-9][0-9]{0,19}$/.test(id||'')&&/^[a-f0-9]{40}$/.test(head||'')&&
  typeof token==='string'&&token.length>10&&token.length<=1024&&!/[\r\n\0]/.test(token),'environment');
 const owner=Object.freeze({repository:'jeep-jim/AvtoCena',workflow:'china-rev5-source-stage-v3.yml',runId:id,attempt:'1',headSha:head,job:'prepare',
  sourceMode:'complete-fresh-replacement',freshReplacementProofSha256:sha(JSON.stringify(proof)),archiveReportSha256:p.archiveReportSha256});
 async function json(suffix){
  const r=await fetchImpl(root+id+suffix,{method:'GET',headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','accept-encoding':'identity'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(r.status!==200||r.headers.get('content-encoding')){await r.body?.cancel();throw Error('china_fresh_fx_owner_remote');}
  const chunks=[];let n=0;for await(const c of r.body){n+=c.length;need(n<=1024*1024,'response_cap');chunks.push(c);}
  return JSON.parse(Buffer.concat(chunks,n).toString());
 }
 async function check(v){
  need(JSON.stringify(v)===JSON.stringify(owner)&&sha(launchContract)===expectedLaunchSha256&&sha(launcherBytes)===p.launcherSha256&&now()<proof.sourceExpiresAt,'binding');
  await assertSourceCurrent();
  const [run,jobs]=await Promise.all([json(''),json('/attempts/1/jobs?per_page=100')]);
  const matching=jobs.jobs?.filter(x=>x.name===p.jobDisplayName);
  need(String(run.id)===id&&run.run_attempt===1&&run.head_sha===head&&run.head_branch==='main'&&run.path===workflow&&run.repository?.id===1289722938&&
   run.repository?.full_name===owner.repository&&run.status==='in_progress'&&run.event==='push'&&jobs.total_count===jobs.jobs?.length&&jobs.total_count<=100&&
   matching?.length===1&&matching[0].status==='in_progress'&&String(matching[0].run_id)===id&&matching[0].head_sha===head,'job');
  await assertSourceCurrent();
 }
 await check(owner);return Object.freeze({owner,assertRunAuthority:check});
}
