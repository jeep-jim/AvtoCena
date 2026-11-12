import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {FROZEN_SPEED_BASELINES,verifyFrozenSpeedBaselines} from '../scripts/verify-frozen-speed-baselines.mjs';

const root=process.cwd();
const expected={
 '2026-11-11-accepted-speed-baseline.json':'32fba449b77e40983803483ea7b6cb4ece09afa997c2ae08dd968c675f528c59',
 '2026-11-11-accepted-browser-speed-baseline.json':'1ad263a9f9c6c4d656ffec4aca51d2b96f5fd284afb759e96ae53cee2bf39b06',
};
const fixture=run=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'avtocena-frozen-speed-'));
 try{
  fs.mkdirSync(path.join(directory,'docs/operations'),{recursive:true});
  for(const name of Object.keys(expected))fs.copyFileSync(path.join(root,'docs/operations',name),path.join(directory,'docs/operations',name));
  return run(directory);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
};

test('both original accepted captures retain their independently pinned digests',()=>{
 assert.deepEqual(FROZEN_SPEED_BASELINES,expected);
 assert.doesNotThrow(()=>verifyFrozenSpeedBaselines(root));
});

test('timing inflation, route substitution and request-budget inflation cannot replace accepted evidence',()=>{
 const mutations=[
  ['2026-11-11-accepted-speed-baseline.json',value=>{for(const row of value.samples)row.seconds*=2;}],
  ['2026-11-11-accepted-speed-baseline.json',value=>{for(const row of value.samples)if(row.path==='/cars/china/BMW/3%20SERIES?powerTo=160&sort=totalRub')row.path='/unrelated-replacement';}],
  ['2026-11-11-accepted-browser-speed-baseline.json',value=>{for(const row of value.checks){row.firstCardsSeconds*=2;for(const filter of row.filters)filter.seconds*=2;}}],
  ['2026-11-11-accepted-browser-speed-baseline.json',value=>{const filter=value.checks[0].filters[0];filter.requests++;filter.paths.push('/api/catalog/search');}],
 ];
 for(const [name,mutate] of mutations)fixture(directory=>{
  const file=path.join(directory,'docs/operations',name),value=JSON.parse(fs.readFileSync(file,'utf8'));
  mutate(value);fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
  assert.throws(()=>verifyFrozenSpeedBaselines(directory),/frozen_speed_baseline_changed/);
 });
});

test('a missing accepted capture fails closed',()=>fixture(directory=>{
 fs.unlinkSync(path.join(directory,'docs/operations','2026-11-11-accepted-browser-speed-baseline.json'));
 assert.throws(()=>verifyFrozenSpeedBaselines(directory));
}));

// This is the reviewed ordinary-activation inventory, not a blanket ban on
// diagnostic container starts or the owner's exact retained-image rescues.
const active=new Set(['regcloud-deploy.yml','owner-navigation-release.yml']);
const retired=new Set([
 'encyclopedia-activate-prepared.yml','encyclopedia-release.yml','owner-resume-prepared-release.yml',
 'regcloud-activate-release.yml','regcloud-resume-japan.yml','regcloud-resume-korea-release.yml',
 'owner-accept-prepared-873.yml','regcloud-activate.yml','regcloud-memory.yml',
]);
// Preserve this historical exception exactly, including its existing script
// hashes, source, original successful run and predecessor assertions.
const historical={'regcloud-owner-rollback.yml':'f16960c03d7f9f264d2546f754aa05c94ed2c4dd17bf3f85f50f3ea3be67ca80'};
const retainedRescues=[
 ['.github/workflows/owner-restore-accepted-speed.yml','f4bba66ec12cfab74b7682858e2d2e9e28cd15bb33036551e67c57c5968ee53f',
  '.github/owner-rollback/restore-accepted-speed.py','a0af419e243f664172ea6aa541b452f9f053b7fa4a5c94993ac473dd8edbf22d'],
 ['.github/workflows/regcloud-owner-approved-rollback.yml','017ecf6f0bea669642f7670fed71bd2324bb7ca4f05a850e91bfddc11c10567e',
  '.github/owner-rollback/activate-approved.py','6cd3c1a335cb3b5d57426291585420451c405eee5b93372a098d6eeadcc03789'],
];
const workflowDirectory=path.join(root,'.github/workflows');
function jobs(source){
 const body=source.match(/^jobs:\s*\n([\s\S]*)/m)?.[1];
 assert.ok(body,'workflow jobs must remain explicit');
 const starts=[...body.matchAll(/^  ([\w-]+):\s*$/gm)];
 assert.ok(starts.length,'workflow jobs must remain reviewable');
 return starts.map((match,index)=>({name:match[1],body:body.slice(match.index,starts[index+1]?.index??body.length)}));
}
function disabled(job){
 const header=job.body.split(/^    steps:/m)[0];
 return /^    if:\s*(?:false|\$\{\{\s*false\s*\}\})\s*(?:#.*)?$/m.test(header);
}
function deployments(source){
 return source.split('\n').filter(line=>!line.trimStart().startsWith('#')).flatMap(line=>[...line.matchAll(/\bbash[ \t]+(?:"[^"\n]*regcloud-deploy-(production|with-browser)\.sh"|'[^'\n]*regcloud-deploy-(production|with-browser)\.sh'|[^\s"']*regcloud-deploy-(production|with-browser)\.sh)/g)].map(match=>match[1]||match[2]||match[3]));
}
function protectedJob(job,label){
 assert.deepEqual([...new Set(deployments(job.body))],['with-browser'],label+' must use only the browser handoff');
 const verifier=job.body.search(/^\s+node scripts\/verify-frozen-speed-baselines\.mjs\s*$/m);
 const contract=job.body.search(/^\s+node --test tests\/release-speed-guard-contract\.test\.mjs\s*$/m);
 const handoff=job.body.search(/\bbash scripts\/regcloud-deploy-with-browser\.sh\b/);
 assert.ok(verifier>=0&&contract>=0&&handoff>verifier&&handoff>contract,label+' requires integrity and contract checks before activation');
}

test('known ordinary activation jobs remain guarded or explicitly retired',()=>{
 for(const file of [...active,...retired]){
  const filename=path.join(workflowDirectory,file);
  // Isolated candidates need not carry every historical controller.
  if(!fs.existsSync(filename))continue;
  const blocks=jobs(fs.readFileSync(filename,'utf8'));
  if(retired.has(file)){
   assert.ok(blocks.every(disabled),file+' must remain disabled at job scope');
  }else{
   const activating=blocks.filter(job=>deployments(job.body).length);
   assert.ok(activating.length,file+' must retain its reviewed activation path');
   for(const job of activating)if(!disabled(job))protectedJob(job,file+'/'+job.name);
  }
 }
});

test('new direct deploy-script entrypoints cannot bypass the reviewed inventory',()=>{
 for(const file of fs.readdirSync(workflowDirectory).filter(name=>/\.ya?ml$/.test(name))){
  const source=fs.readFileSync(path.join(workflowDirectory,file),'utf8');
  if(!deployments(source).length)continue;
  if(Object.hasOwn(historical,file)){
   assert.equal(createHash('sha256').update(source).digest('hex'),historical[file],'historical exception must stay exact: '+file);
   continue;
  }
  for(const job of jobs(source).filter(job=>deployments(job.body).length)){
   if(disabled(job))continue;
   assert.ok(active.has(file),'unreviewed activation workflow: '+file);
   protectedJob(job,file+'/'+job.name);
  }
 }
});

test('owner-authorized retained-image rescues keep their exact workflow and helper scope',()=>{
 for(const [workflow,workflowHash,helper,helperHash] of retainedRescues){
  if(fs.existsSync(path.join(root,workflow)))assert.ok(fs.existsSync(path.join(root,helper)),workflow+' requires its pinned helper');
  for(const [file,hash] of [[workflow,workflowHash],[helper,helperHash]]){
   if(!fs.existsSync(path.join(root,file)))continue;
   assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),hash,'historical rescue scope changed: '+file);
  }
 }
});

test('CI explicitly executes the release contract that npm test does not include',()=>{
 const file=path.join(workflowDirectory,'ci.yml');
 if(!fs.existsSync(file))return;
 const source=fs.readFileSync(file,'utf8');
 assert.match(source,/^\s+node --test tests\/release-speed-guard-contract\.test\.mjs\s*$/m);
 assert.match(source,/^\s+node scripts\/verify-frozen-speed-baselines\.mjs\s*$/m);
});
