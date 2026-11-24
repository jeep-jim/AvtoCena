import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import profile from './release-profile.json' with {type:'json'};
import {GATE_FILES} from '../home-ui-only-20261123/contract.mjs';
import {verifyReadonlyInvocation} from '../../../scripts/lib/readonly-marker-invocation.mjs';

export const ROOT=fileURLToPath(new URL('../../../',import.meta.url));
export const PROFILE=Object.freeze(profile);
export const MARKER='.github/market-runs/aj-system-japan-only.json';
export const sha256=value=>createHash('sha256').update(value).digest('hex');
export const need=(value,code)=>{if(!value)throw Error('aj_release_'+code);};
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const sameSet=(a,b)=>Array.isArray(a)&&a.length===b.length&&new Set(a).size===a.length&&a.every(x=>b.includes(x));

export function checkedProfile(value=PROFILE){
  need(value.version===1&&value.operation==='release-ajes-japan-only-20261124','profile_kind');
  for(const key of ['retainedSource','retainedTree','privateIndexParent','source','tree'])need(sha(value[key]),'profile_'+key);
  for(const key of ['retainedSourceCalculationVersion','servingCalculationVersion','privateIndexDigest',
    'sourceCalculationVersion','codeDiffSha256','inventorySha256'])need(digest(value[key]),'profile_'+key);
  need(value.source!==value.retainedSource,'profile_source_unchanged');
  need(Array.isArray(value.codePaths)&&value.codePaths.length>0&&new Set(value.codePaths).size===value.codePaths.length
    &&value.codePaths.every(name=>typeof name==='string'&&!name.includes('..')&&/^(?:apps\/web\/|tests\/)/.test(name)),'profile_paths');
  // The AJ change may affect the catalog integration and admin form, never the
  // engine, its inputs, dependency lockfiles or the permanent encyclopedia.
  need(!value.codePaths.some(name=>/^apps\/web\/(?:lib\/encyclopedia\/|app\/.*encyclopedia|package\.json|tsconfig|next\.config)/.test(name)
    ||/^apps\/web\/lib\/catalog\/(?:.*pric.*|rates|customs|calculation|knowledge-core|spec-normalization|offer-parameter)/.test(name)),
    'protected_path');
  const observed=value.inventory;
  need(observed?.version===1&&observed.status==='verified_inventory_requires_review'&&observed.readOnly===true
    &&observed.activationAuthorized===false&&observed.mutations===0&&observed.supplierRequests===0
    &&observed.lockMode==='shared_nonblocking'&&observed.nginxSha256==='b55e61e9686c639d9f0deac678b881ec56633e1cfd2b4703084b0ad9aaecaf6f'
    &&observed.candidatePort?.port===3003&&observed.candidatePort.socketListening===false,'inventory');
  need(sha256(JSON.stringify(observed))===value.inventorySha256,'inventory_digest');
  const current=observed.containers?.serving;
  need(current?.release===value.retainedSource&&current.name==='avtocena-china-grid-dark-22867cbcfaee'
    &&current.port===3002&&current.id==='52e44ba2810796f9a12ac83984d9571f71ac1290d852206d2a259ad44da02a8d'
    &&current.image==='sha256:8a7326fc17de9a28ae66a4915e68038ac089ba4cdf2954bd7fcbd7cbda46ccf8'
    &&Number.isInteger(current.pid)&&current.pid>0&&Number.isFinite(Date.parse(current.startedAt)),'retained_inventory');
  return value;
}

export function checkInvocation(root=ROOT,env=process.env){
  checkedProfile();
  return verifyReadonlyInvocation({root,env,markerPath:MARKER,operation:PROFILE.operation});
}

function git(root,args){
  try{return execFileSync('/usr/bin/git',['--no-optional-locks','-c','core.fsmonitor=false',...args],
    {cwd:root,encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']});}
  catch{throw Error('aj_release_source_git');}
}
function calculationRecords(root,ref){
  return git(root,['ls-tree','-rz','--full-tree',ref]).split('\0').filter(Boolean).filter(record=>{
    const name=record.slice(record.indexOf('\t')+1);
    return /^(?:apps\/web\/lib\/|packages\/|data\/|scripts\/)/.test(name)
      ||/^(?:package(?:-lock)?\.json|Dockerfile|tsconfig[^/]*\.json|apps\/web\/(?:package\.json|tsconfig[^/]*\.json|next\.config\.[^/]+)|\.github\/workflows\/deploy-yandex\.yml)$/.test(name);
  });
}
export const calculationFingerprint=(root,ref)=>sha256('avtocena-calculator-v1\0'+calculationRecords(root,ref).join('\0'));

export function verifySource(root,value=PROFILE){
  checkedProfile(value);
  need(git(root,['rev-parse','HEAD']).trim()===value.source&&git(root,['rev-parse','HEAD^{tree}']).trim()===value.tree,'source_head');
  need(git(root,['rev-parse',value.retainedSource+'^{tree}']).trim()===value.retainedTree,'source_retained_tree');
  need(!git(root,['status','--porcelain=v1','--untracked-files=normal']).trim(),'source_dirty');
  const parents=git(root,['cat-file','commit',value.source]).split('\n\n')[0].split('\n').filter(x=>x.startsWith('parent '));
  need(parents.length===1&&parents[0]==='parent '+value.retainedSource,'source_not_direct_patch');
  const paths=git(root,['diff','--name-only','--no-renames',value.retainedSource,value.source,'--']).trim().split('\n');
  need(JSON.stringify(paths)===JSON.stringify(value.codePaths),'source_paths');
  const diff=git(root,['diff','--no-ext-diff','--no-renames','--no-textconv','--binary','--full-index',value.retainedSource,value.source,'--']);
  need(sha256(diff)===value.codeDiffSha256,'source_diff');
  need(calculationFingerprint(root,value.retainedSource)===value.retainedSourceCalculationVersion
    &&calculationFingerprint(root,value.source)===value.sourceCalculationVersion,'source_calculation');
  return {version:1,source:value.source,tree:value.tree,retainedSource:value.retainedSource,
    sourceCalculationVersion:value.sourceCalculationVersion,servingCalculationVersion:value.servingCalculationVersion,
    codeDiffSha256:value.codeDiffSha256,codePaths:paths,protectedTreeUnchanged:true,clean:true};
}

export function verifyGates(root=ROOT){
  for(const [file,expected]of Object.entries(GATE_FILES))need(sha256(fs.readFileSync(path.join(root,file)))===expected,'gate_changed');
  const baseline=JSON.parse(fs.readFileSync(path.join(root,'docs/operations/2026-11-11-accepted-speed-baseline.json'),'utf8'));
  const routes=[...new Set(baseline.samples.map(row=>row.path))];
  need(baseline.complete===true&&routes.length===17,'gate_routes');
  return routes;
}

export function assertServerReceipt(receipt,nonce,phase,value=PROFILE,routes=verifyGates()){
  need(receipt?.release===value.source&&receipt.nonce===nonce&&receipt.phase===phase&&receipt.exitCode===0
    &&digest(receipt.logSha256)&&receipt.baselineSha256===GATE_FILES['docs/operations/2026-11-11-accepted-speed-baseline.json'],'server_identity');
  const s=receipt.summary;
  need(s?.marketScope===''&&s.functionalPassed===true&&s.acceptedBaselineEnforced===true
    &&s.samples===51&&sameSet(s.routes,routes)&&sameSet(s.acceptedBaselineRoutes,routes),'server_coverage');
  need(Array.isArray(receipt.phases)&&receipt.phases.length===51,'server_samples');
  for(const route of routes)for(const period of ['warm','after_ttl','after_directory_ttl'])need(receipt.phases.filter(row=>
    row.path===route&&row.performanceGate===period&&row.functionalPassed===true).length===1,'server_phase');
  return receipt;
}

export function assertBrowserReceipt(verdict,nonce,value=PROFILE){
  need(verdict?.schemaVersion===1&&verdict.release===value.source&&verdict.nonce===nonce
    &&verdict.passed===true&&verdict.functionalPassed===true&&verdict.speedPassed===true&&digest(verdict.reportSha256),'browser_failed');
  return verdict;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{need(process.argv.length===3&&process.argv[2]==='--check-invocation','arguments');console.log(JSON.stringify(checkInvocation()));}
  catch(error){console.error(/^aj_release_[a-zA-Z0-9_]+$/.test(error.message||'')?error.message:'aj_release_entry_refused');process.exitCode=1;}
}
