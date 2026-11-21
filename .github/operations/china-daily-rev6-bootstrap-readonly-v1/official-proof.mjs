/** Fixed GitHub metadata checks. Never pass this token into the S3 reader. */
import assert from 'node:assert/strict';
const owner='jeep-jim/AvtoCena',repoId=1289722938;
const WORKFLOW='.github/workflows/china-daily-rev6-bootstrap-readonly-v1.yml';
const JOB='Verify accepted China daily bootstrap without supplier';
const pins=[
 ['44862697281','136719412770','b77f7fba1141ee027107df3cf7028dcb52cd3d31','.github/workflows/china-v4-continuation-chain.yml','Continue China from chained private checkpoints'],
 ['44871616387','136747174596','f9e1e2c7e98ab90a0a49264b2e762cbc05bf2071','.github/workflows/china-rev5-reuse-archive-v2.yml','Prepare full fresh China with one frozen quote'],
 ['44877398197','136765020501','a0d3be5a8938ac1c6c51e913e9ff385af16803d1','.github/workflows/china-rev6-public-reconcile-once.yml','Verify live China revision 6 without changes'],
 ['44877897872','136766558434','549ea643a79aa0d648d7b044b092c032332706d9','.github/workflows/china-rev6-ford-direct-readonly.yml','Verify live China Ford direct routes without changes'],
];
export {pins, owner, repoId, WORKFLOW, JOB};
const boundJSON=async (r,max=512*1024)=>{
 assert.ok(r.status===200&&r.body&&!r.headers.get('content-encoding'),'official_http');
 const a=[];let seen=0;
 for await(const b of r.body){assert.ok((seen+=b.byteLength)<=max,'official_response_bound');a.push(b);}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(a)));
};
export async function verifyOfficialProof({env=process.env,fetcher=fetch}={}){
 const token=env.GITHUB_TOKEN;
 assert.ok(env.GITHUB_REPOSITORY===owner&&env.GITHUB_REPOSITORY_ID===String(repoId)&&env.GITHUB_REF==='refs/heads/main'&&
  env.GITHUB_RUN_ATTEMPT==='1'&&env.GITHUB_JOB==='observe'&&env.GITHUB_EVENT_NAME==='push'&&
  env.GITHUB_WORKFLOW_REF===owner+'/'+WORKFLOW+'@refs/heads/main'&&/^[a-f0-9]{40}$/.test(env.GITHUB_SHA??'')&&/^[1-9]\d{0,19}$/.test(env.GITHUB_RUN_ID??'')&&
  /^ghs_[A-Za-z0-9_.-]{20,4092}$/.test(token??''),'protected_actor_environment');
 const base='https://api.github.com/repos/'+owner+'/actions/',deadline=AbortSignal.timeout(20000);
 const get=path=>boundJSONResponse(path);
 async function boundJSONResponse(path){
  return boundJSON(await fetcher(base+path,{method:'GET',redirect:'error',signal:deadline,headers:{authorization:'Bearer '+token,
   accept:'application/vnd.github+json','accept-encoding':'identity'}}));
 }
 const official=(r,id,sha,workflow)=>String(r?.id)===id&&r.repository?.id===repoId&&r.repository?.full_name===owner&&
   r.head_sha===sha&&r.head_branch==='main'&&r.path===workflow&&r.run_attempt===1&&r.event==='push';
 const run=env.GITHUB_RUN_ID,sha=env.GITHUB_SHA;
 const [{active,jobs},...ok]=await Promise.all([
  Promise.all([get('runs/'+run),get('runs/'+run+'/attempts/1/jobs?per_page=10')]).then(([active,jobs])=>({active,jobs})),
  ...pins.map(async([id,jid,commit,path,name])=>{
   const [r,j]=await Promise.all([get('runs/'+id),get('jobs/'+jid)]);
   assert.ok(official(r,id,commit,path)&&r.status==='completed'&&r.conclusion==='success'&&String(j.id)===jid&&String(j.run_id)===id&&
    j.name===name&&j.head_sha===commit&&j.status==='completed'&&j.conclusion==='success','terminal_or_current_read_proof');
   return true;
  })
 ]);
 const list=jobs?.jobs?.filter(j=>j.name===JOB);
 assert.ok(official(active,run,sha,WORKFLOW)&&active.status==='in_progress'&&jobs?.total_count===1&&list?.length===1&&
  String(list[0].run_id)===run&&list[0].head_sha===sha&&list[0].status==='in_progress','official_current_protected_job');
 return {kind:'official_china_rev6_bootstrap_read_authority',priorSuccessfulJobs:ok.length,currentJobAttested:true,requests:10,providerRequests:0,storageWrites:0};
}
if(import.meta.url===new URL(process.argv[1], 'file://'+process.cwd()+'/').href)
 try{console.log(JSON.stringify(await verifyOfficialProof()));}catch(e){
  console.error(JSON.stringify({kind:'official_proof_held',reason:['protected_actor_environment','official_http','official_response_bound','terminal_or_current_read_proof','official_current_protected_job'].includes(e?.message)?e.message:'official_transport',storageWrites:0,providerRequests:0}));
  process.exitCode=3;
 }
