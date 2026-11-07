import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const repo='jeep-jim/AvtoCena',expectedHead='1ebc7c687b271ced9ff284a2d82efb25a03f9842';
const main=process.env.EXPECTED_MAIN,token=process.env.GITHUB_TOKEN;
assert.match(main||'',/^[a-f0-9]{40}$/);assert.ok(token);
const base='https://api.github.com/repos/'+repo;
async function api(path,method='GET',body){
 const response=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('github_operation_failed:'+method+':'+response.status);
 return response.json();
}
const pr=await api('/pulls/1718');assert.equal(pr.merged,true);assert.equal(pr.head.sha,expectedHead);
const runs=(await api('/actions/runs?head_sha='+expectedHead+'&event=pull_request&per_page=100')).workflow_runs;
assert.ok(runs.length>=1);assert.ok(runs.some(r=>r.name==='CI'));
for(const r of runs){assert.equal(r.status,'completed',r.name);assert.equal(r.conclusion,'success',r.name);}
const ref=await api('/git/ref/heads/main');assert.equal(ref.object.sha,main,'main changed before preparation');
assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),main);
execFileSync('git',['merge-base','--is-ancestor',pr.merge_commit_sha,main]);
const deploys=(await api('/actions/workflows/regcloud-deploy.yml/runs?per_page=20')).workflow_runs;
assert.ok(!deploys.some(r=>r.status!=='completed'),'existing deployment must finish; do not create a duplicate');
const path='.github/market-runs/regcloud-deploy.json',original=JSON.parse(fs.readFileSync(path,'utf8'));
assert.ok(Array.isArray(original.requiredResearchBatches)&&original.requiredResearchBatches.length>0);
for(const list of [original.requiredResearchBatches,original.publicResearchBatches])for(const file of list||[])assert.ok(fs.existsSync(file),'missing existing batch:'+file);
const requestedAt=new Date().toISOString();
const reason='Owner-authorized speed recovery 2026-11-07: publish PR1718, exact ready metadata outside supplier queue, same-visitor bounded recovery reuse and removal of unused model payload. Preserve sources, fresh/stale deadlines, provider restrictions, pricing, roles and all required release checks. Complete Korea/Japan <=160 coverage and general ZMA performance parity remain unaccepted; require exact-release visible-card readback.';
const next={...original,reason,requestedAt};
for(const key of Object.keys(original))if(!['reason','requestedAt'].includes(key))assert.deepEqual(next[key],original[key]);
assert.deepEqual(Object.keys(next).sort(),Object.keys(original).sort());
const content=JSON.stringify(next,null,2)+'\n';
// Only an immutable git blob is created. No ref, deployment, settings or live data are changed here.
const blob=await api('/git/blobs','POST',{content,encoding:'utf-8'});
assert.match(blob.sha,/^[a-f0-9]{40}$/);
const markerPreviousBlob=execFileSync('git',['rev-parse','HEAD:'+path],{encoding:'utf8'}).trim();
const tree=execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim();
fs.mkdirSync('release-marker-evidence',{recursive:true});
const evidence={at:requestedAt,repository:repo,pr:1718,verifiedHead:expectedHead,expectedMain:main,baseTree:tree,path,markerPreviousBlob,markerNextBlob:blob.sha,reason,requestedAt,unchangedOtherFields:true,refUpdated:false,deploymentStarted:false,checks:runs.map(r=>({id:r.id,name:r.name,conclusion:r.conclusion}))};
fs.writeFileSync('release-marker-evidence/prepared.json',JSON.stringify(evidence,null,2));
fs.writeFileSync('release-marker-evidence/regcloud-deploy.json',content);
console.log('CHECKED_MARKER_BLOB',JSON.stringify(evidence));
