import unassignedRecords from './unassigned-runs-20261123.json' with {type:'json'};
import {execFileSync} from 'node:child_process';
import {sha256} from '../home-ui-only-20261123/contract.mjs';
import {APPROVAL_WORKFLOW,approvalOperation} from './profile.mjs';

const REPO = 'jeep-jim/AvtoCena', API = 'https://api.github.com/repos/' + REPO;
const need = (value, code) => { if (!value) throw Error('home_evidence_' + code); };
const SAFE_CONCURRENT = new Set(['.github/workflows/ci.yml',APPROVAL_WORKFLOW,
  '.github/workflows/home-ui-image-build.yml','.github/workflows/home-ui-runtime-inventory.yml',
  '.github/workflows/catalog-saved-intake-readonly-probe.yml']);
// Both cancellation endpoints returned 409. Force-cancel explicitly reported
// these runs had never been queued, although the list endpoint included them.
// Run 45130287940. A newly assigned job or a new attempt is a real conflict.
const unassignedRuns=new Map(unassignedRecords.map(([id,path,createdAt])=>[id,{path,createdAt}]));
async function verifyUnassignedRun(reader,listed){
  const expected=unassignedRuns.get(listed.id);
  const sameRun=run=>Boolean(expected && run.status==='queued' && !run.conclusion &&
    run.run_attempt===1 && run.path===expected.path && run.created_at===expected.createdAt &&
    run.id===listed.id && run.repository?.full_name===REPO && run.head_sha===listed.head_sha);
  need(sameRun(listed),'other_workflow_active');
  const jobs=await reader.json('/actions/runs/'+listed.id+'/jobs?filter=all&per_page=100');
  need(jobs.total_count===0 && Array.isArray(jobs.jobs) && jobs.jobs.length===0,'historical_run_assigned');
  need(sameRun(await reader.json('/actions/runs/'+listed.id)),'historical_run_changed');
}
const APPROVAL_CODE = [APPROVAL_WORKFLOW,'.github/operations/home-ui-activation-20261123/profile.mjs',
  'scripts/lib/readonly-marker-invocation.mjs'];

export function githubReader({token = process.env.GH_TOKEN, fetchImpl = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
  need(typeof token === 'string' && token.length > 0, 'token');
  async function get(url, options) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response;
      try {
        response = await fetchImpl(url, {...options, signal:AbortSignal.timeout(30000)});
      } catch {
        if (attempt === 2) throw Error('home_evidence_github_transport');
      }
      if (response && ![408, 429, 500, 502, 503, 504].includes(response.status)) return response;
      if (attempt === 2) throw Error('home_evidence_github_transient_http');
      await response?.body?.cancel();
      await pause(1000 * (attempt + 1));
    }
  }
  async function request(suffix, binary=false) {
    need(/^\/actions\/[a-zA-Z0-9_./?=&%:-]+$/.test(suffix), 'endpoint');
    const response = await get(API + suffix,{method:'GET',redirect:'manual',
      headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});
    if (binary) {
      need(response.status === 302, 'artifact_redirect');
      const location = new URL(response.headers.get('location'));
      need(location.protocol === 'https:' && !location.username && !location.password
        && (/\.blob\.core\.windows\.net$/.test(location.hostname) || /\.actions\.githubusercontent\.com$/.test(location.hostname)), 'artifact_host');
      const download = await get(location,{method:'GET',redirect:'error'});
      need(download.ok, 'artifact_download');
      const buffer = Buffer.from(await download.arrayBuffer());
      need(buffer.length > 0 && buffer.length <= 1048576, 'artifact_control_size');
      return buffer;
    }
    need(response.status === 200, 'github_status');
    return response.json();
  }
  return {json:suffix=>request(suffix),archive:id=>request('/actions/artifacts/'+id+'/zip',true)};
}

// GitHub can briefly return a count and a page from opposite sides of a job
// transition. Only a complete observation can authorize a switch or acceptance.
async function readCompleteRunPage(reader, status, pause) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const page = await reader.json('/actions/runs?status=' + status + '&per_page=100');
    if (Number.isSafeInteger(page.total_count) && page.total_count <= 100 && Array.isArray(page.workflow_runs)
        && page.workflow_runs.length === page.total_count) return page;
    if (attempt < 2) await pause(1500);
  }
  throw Error('home_evidence_active_runs_incomplete');
}

export async function assertPublicationQuiescence(reader, ownRunId, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const recovery = await reader.json('/actions/runs/45104426224');
  need(recovery.id === 45104426224 && recovery.status === 'completed'
    && recovery.repository?.full_name === REPO, 'korea_recovery_active');
  const observed = new Map();
  for (const status of ['in_progress','queued','waiting','pending','requested']) {
    const page = await readCompleteRunPage(reader, status, pause);
    for(const run of page.workflow_runs) if(String(run.id)!==String(ownRunId)) observed.set(run.id,run);
  }
  const conflicts=[...observed.values()].filter(run=>!SAFE_CONCURRENT.has(run.path));
  for(let start=0;start<conflicts.length;start+=4){
    await Promise.all(conflicts.slice(start,start+4).map(run=>verifyUnassignedRun(reader,run)));
  }
  return {koreaRunId:recovery.id,koreaStatus:recovery.status,koreaConclusion:recovery.conclusion,
    checkedAt:new Date().toISOString(),otherWriterRuns:0,historicalUnassignedRuns:conflicts.length};
}

function git(root,args) {
  try { return execFileSync('/usr/bin/git',['--no-optional-locks','-c','core.fsmonitor=false',...args],
    {cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:16*1024*1024,timeout:30000}); }
  catch { throw Error('home_evidence_git'); }
}

export function controllerCodeFingerprint(root, ref) {
  need(/^[a-f0-9]{40}$/.test(ref), 'controller_ref');
  const records=git(root,['ls-tree','-rz','--full-tree',ref]).split('\0').filter(Boolean).filter(record=>{
    const name=record.slice(record.indexOf('\t')+1);
    return name!=='AGENTS.md' && !/^docs\/.*\.md$/.test(name) && !/^\.github\/market-runs\/[^/]+\.json$/.test(name);
  });
  need(records.length>0,'controller_tree');
  return sha256(records.join('\0'));
}

export async function verifyControllerCi(reader, root, invocation) {
  const expected=controllerCodeFingerprint(root,invocation.sourceSha);
  const page=await reader.json('/actions/workflows/ci.yml/runs?status=success&per_page=30');
  need(Array.isArray(page.workflow_runs),'ci_runs');
  for(const run of page.workflow_runs) {
    if(run.status!=='completed'||run.conclusion!=='success'||run.path!=='.github/workflows/ci.yml'
      ||run.repository?.full_name!==REPO||!/^[a-f0-9]{40}$/.test(run.head_sha))continue;
    git(root,['fetch','--no-write-fetch-head','--depth=1','origin',run.head_sha]);
    if(controllerCodeFingerprint(root,run.head_sha)!==expected)continue;
    const jobs=await reader.json('/actions/runs/'+run.id+'/jobs?per_page=100');
    need(Array.isArray(jobs.jobs)&&jobs.total_count===jobs.jobs.length&&jobs.jobs.length>0
      &&jobs.jobs.every(job=>job.status==='completed'&&job.conclusion==='success')
      &&jobs.jobs.some(job=>job.name==='validate'),'ci_jobs');
    return {runId:run.id,headSha:run.head_sha,status:'success',codeFingerprint:expected};
  }
  throw Error('home_evidence_matching_successful_ci_missing');
}

export async function readSafeArtifact(reader,run,name,member) {
  const listing=await reader.json('/actions/runs/'+run.id+'/artifacts?per_page=100');
  need(Array.isArray(listing.artifacts)&&listing.total_count===listing.artifacts.length,'artifacts_incomplete');
  const rows=listing.artifacts.filter(row=>row.name===name);
  need(rows.length===1,'artifact_count');
  const row=rows[0];
  need(row.expired===false&&row.workflow_run?.id===run.id&&row.workflow_run.head_sha===run.head_sha
    &&Number.isSafeInteger(row.size_in_bytes)&&row.size_in_bytes>0&&row.size_in_bytes<=1048576
    &&/^sha256:[a-f0-9]{64}$/.test(row.digest||''),'artifact_identity');
  const archive=await reader.archive(row.id);
  need('sha256:'+sha256(archive)===row.digest,'artifact_digest');
  need(['approval.json'].includes(member),'artifact_member');
  const script="import io,json,sys,zipfile;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));names=z.namelist();assert names==['approval.json'];info=z.getinfo('approval.json');assert info.file_size<=65536;value=json.loads(z.read(info));print(json.dumps(value,separators=(',',':')))";
  let value;
  try {value=JSON.parse(execFileSync('/usr/bin/python3',['-I','-B','-c',script],
    {input:archive,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:65536}));}
  catch {throw Error('home_evidence_artifact_contents');}
  return {value,artifactId:row.id,archiveSha256:sha256(archive)};
}

export async function findPlanApproval(reader, root, receipt) {
  const page=await reader.json('/actions/workflows/home-ui-plan-approval.yml/runs?status=success&per_page=30');
  need(Array.isArray(page.workflow_runs),'approval_runs');
  for(const run of page.workflow_runs) {
    if(run.status!=='completed'||run.conclusion!=='success'||run.path!==APPROVAL_WORKFLOW||run.event!=='push'
      ||run.head_branch!=='main'||run.run_attempt!==1||run.repository?.full_name!==REPO
      ||Date.parse(run.created_at)<Date.parse(receipt.createdAt))continue;
    const evidence=await readSafeArtifact(reader,run,'home-ui-plan-approval-safe-receipt','approval.json');
    const value=evidence.value;
    if(value.runId!==receipt.runId||value.nonce!==receipt.plan.nonce||value.planSha256!==receipt.planSha256)continue;
    need(value.version===1&&value.status==='verified_exact_home_plan_marker'&&value.sourceSha===run.head_sha
      &&value.approvalRunId===String(run.id)&&value.approvalRunAttempt===1,'approval_receipt');
    git(root,['fetch','--no-write-fetch-head','--depth=2','origin',run.head_sha]);
    for(const filename of APPROVAL_CODE) need(git(root,['rev-parse',run.head_sha+':'+filename]).trim()
      ===git(root,['rev-parse','HEAD:'+filename]).trim(),'approval_controller_changed');
    // The successful approval workflow proved the real push.before/after and
    // marker-only diff. Bind that proof to the artifact's actual Git blob too.
    const marker=JSON.parse(git(root,['show',run.head_sha+':.github/market-runs/home-ui-plan-approval.json']));
    need(marker.version===1&&marker.operation===approvalOperation({runId:receipt.runId,nonce:receipt.plan.nonce,planSha256:receipt.planSha256})
      &&marker.approvedSourceSha===value.approvedSourceSha,'approval_blob');
    return {approvalRunId:run.id,approvalSourceSha:run.head_sha,artifactId:evidence.artifactId,
      archiveSha256:evidence.archiveSha256,planSha256:value.planSha256};
  }
  return null;
}
