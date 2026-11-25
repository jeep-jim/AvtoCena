import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
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

test('the actual server gate preserves scoped market and shared acceptance against the complete frozen capture',()=>{
 // Run the real Python gate with mocked I/O, including every expiry phase and
 // blocking regressions. The release workflow runs this contract before SSH.
 execFileSync('python3',['-I','-B','tests/regcloud-performance-gate.test.py','MarketScopeTests','AcceptedBaselineTests'],{
  cwd:root,encoding:'utf8',stdio:'pipe',
  env:{...process.env,AVTOCENA_RELEASE_MARKETS:'',AVTOCENA_SPEED_BASELINE_MODE:'observe',AVTOCENA_SPEED_BASELINE:''},
 });
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
const active=new Set(['regcloud-deploy.yml','owner-navigation-release.yml','release-paid-korea-history.yml','release-prepared-feed-delivery.yml']);
const retired=new Set([
 'release-minimal-paid-encar.yml','release-paid-encar.yml','release-desktop-autobot.yml',
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

// The AJ-only controller starts from the installed 22867 image context. Its
// current-ingress adapter differs from the older avtocena-production script,
// so register it explicitly instead of pretending it uses that wrapper.
const customActivators=new Map([
 ['aj-system-japan-only.yml','.github/operations/ajes-japan-only-20261124/release.mjs'],
 ['catalog-next-china-release.yml','scripts/catalog-next/release.mjs'],
 ['catalog-next-china-photo-release.yml','scripts/catalog-next/code-entry.mjs'],
]);

test('code-only photo activation preserves the independent China fence and complete browser handoff',()=>{
 const workflow=fs.readFileSync(path.join(workflowDirectory,'catalog-next-china-photo-release.yml'),'utf8');
 const gate=workflow.indexOf('node scripts/verify-frozen-speed-baselines.mjs');
 const contracts=workflow.indexOf('tests/catalog-next-*.test.mjs tests/release-speed-guard-contract.test.mjs');
 const sourceVerification=workflow.indexOf('scripts/catalog-next/code-entry.mjs --verify');
 const build=workflow.indexOf('scripts/catalog-next/code-entry.mjs --build');
 const restoration=workflow.indexOf('scripts/catalog-next/restore-photo-image.mjs --run');
 const firstHostKey=workflow.indexOf('SSH_PRIVATE_KEY:');
 const activation=workflow.indexOf('scripts/catalog-next/code-entry.mjs --run');
 assert.ok(gate>=0 && contracts>gate && activation>contracts);
 assert.ok(firstHostKey>contracts && restoration>firstHostKey && activation>restoration,
  'the exact archived image is restored only after contracts and before normal publication');
 assert.ok(sourceVerification>contracts && build>sourceVerification && build<firstHostKey && activation>build,
  'the photo-only source is built and roundtripped before host contact');
 const steps=workflow.split(/(?=^      - )/m);
 const buildStep=steps.find(step=>step.includes('scripts/catalog-next/code-entry.mjs --build'));
 const restoreStep=steps.find(step=>step.includes('scripts/catalog-next/restore-photo-image.mjs --run'));
 assert.match(buildStep,/if: steps\.photo_scope\.outputs\.scope == 'catalog-photo-recovery-v1'/);
 assert.match(restoreStep,/if: steps\.photo_scope\.outputs\.scope == 'catalog-photo-japan-power-v1'/);
 assert.match(buildStep,/CHINA_BUILD_DOCKER_HOST: \$\{\{ steps\.photo_docker\.outputs\.sock \}\}/);
 assert.doesNotMatch(buildStep,/SSH_PRIVATE_KEY|restore-photo-image/);
 const selector=steps.find(step=>step.includes('id: photo_scope'));
 assert.match(selector,/checkedCatalogCodeScope\(plan\)/);
 assert.match(selector,/\.github\/operations\/catalog-next\/china-code-serving-plan\.json/);
 assert.ok(workflow.indexOf(selector)>sourceVerification && workflow.indexOf(selector)<build);
 assert.match(workflow,/group: catalog-next-china\n\s+cancel-in-progress: false/);
 assert.match(workflow,/paths: \[\.github\/market-runs\/catalog-next-china-photo-release\.json\]/);
 assert.doesNotMatch(workflow,/AUTO_API_CHE168_KEY|schedule:|release\.mjs --/);
 const entry=fs.readFileSync(path.join(root,'scripts/catalog-next/code-entry.mjs'),'utf8');
 assert.match(entry,/verifyReadonlyInvocation\([\s\S]*operation: 'activate-china-photo-code'/);
 assert.match(entry,/verifyChinaPhotoCodeRuntime/);
 const adapter=fs.readFileSync(path.join(root,'scripts/catalog-next/daily-release.mjs'),'utf8');
 const stages=["session.call('start')","session.call('functional')","session.call('speed')","session.call('switch')",
  "tests/browser/owner-filter-speed-live.mjs","scripts/catalog-next/browser-acceptance.mjs",
  "scripts/catalog-next/photo-japan-browser-acceptance.mjs","session.call('browser_evidence'","session.call('accept'"];
 let previous=-1;
 for(const stage of stages){const at=adapter.indexOf(stage);assert.ok(at>previous,'code acceptance order: '+stage);previous=at;}
 assert.match(adapter,/details\.nonce === nonce/);
 assert.match(adapter,/details\.precedingSpeedReportSha256 === hash\(speedRaw\)/);
 assert.match(adapter,/photoJapan\.oracleSha256 === hash\(await fs\.readFile\(oraclePath\)\)/);
 assert.match(adapter,/photoJapanReportBase64: photoJapanRaw\.toString\('base64'\)/);
 assert.match(adapter,/codeUpdate && plan\.codeScope === 'catalog-photo-recovery-v1'/);
 assert.match(adapter,/args: \['--photo-only'\]/);
 assert.match(adapter,/photo\.kind === 'china-photo-browser-v1'/);
 assert.match(adapter,/photo\.codeScope === plan\.codeScope/);
 assert.match(adapter,/photo\.oracleSha256 === hash\(await fs\.readFile\(oraclePath\)\)/);
 assert.match(adapter,/photoReportBase64: photoRaw\.toString\('base64'\)/);
 assert.match(adapter,/photo\.readOnlyBrowserFence === true/);
 assert.match(adapter,/\['passed', 'chinaPhotoPassed', 'japanFreshnessPassed', 'japanPowerApiPassed', 'japanUiPassed'\]/);
 const browser=fs.readFileSync(path.join(root,'scripts/catalog-next/photo-japan-browser-acceptance.mjs'),'utf8');
 assert.match(browser,/runPhotoJapanBrowserAcceptance\(options\)\{return runPhotoBrowserAcceptance\(options,true\);\}/);
 assert.match(browser,/runChinaPhotoBrowserAcceptance\(options\)\{return runPhotoBrowserAcceptance\(options,false\);\}/);
 assert.match(browser,/report\.chinaPhotoPassed&&report\.japanFreshnessPassed&&report\.japanPowerApiPassed&&report\.japanUiPassed/);
 const host=fs.readFileSync(path.join(root,'scripts/catalog-next/release-host.py'),'utf8');
 assert.match(host,/code_update\(self\.plan\) and code_scope\(self\.plan\) == PHOTO_CODE_SCOPE/);
 assert.match(host,/photo\.get\('kind'\) == 'china-photo-browser-v1'/);
 assert.match(host,/photo\.get\('readOnlyBrowserFence'\) is True/);
 assert.match(host,/code_update\(self\.plan\) and code_scope\(self\.plan\) == PHOTO_JAPAN_CODE_SCOPE/);
 assert.match(host,/'passed', 'chinaPhotoPassed', 'japanFreshnessPassed',[\s\S]*'japanPowerApiPassed', 'japanUiPassed'/);
 assert.match(adapter,/validateChinaCodeTransition\(candidate, prior\.current\)/);
 const cycle=fs.readFileSync(path.join(root,'scripts/catalog-next/code-controller.mjs'),'utf8');
 assert.match(cycle,/transition: 'code-update'/);
 assert.match(cycle,/state\.commit/); assert.match(cycle,/state\.abortReserved/); assert.match(cycle,/state\.finalizeRollback/);
 assert.doesNotMatch(cycle,/prepareChinaGeneration|restorePrivateChinaGeneration|refreshChinaSource/);
});

test('photo CI always tests shared and China behavior while the combined profile still requires every PW test',()=>{
 const workflow=fs.readFileSync(path.join(workflowDirectory,'verify-china-photo-code.yml'),'utf8');
 assert.match(workflow,/checkedCatalogCodeScope\(JSON\.parse\(fs\.readFileSync\('\.github\/operations\/catalog-next\/china-code-serving-plan\.json'\)\)\)/);
 const matrix=workflow.match(/^          PHOTO_EXTRA_TESTS=\(\)\n[\s\S]*?^          esac$/m)?.[0];
 assert.ok(matrix,'the two reviewed scopes must be explicit');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'photo-scope-matrix-'));
 try{
  fs.mkdirSync(path.join(directory,'tests'));
  const names=['tests/japan-pw-browser.test.ts','tests/japan-pw-source.test.ts'];
  for(const filename of names)fs.writeFileSync(path.join(directory,filename),'');
  const run=scope=>execFileSync('bash',['-euo','pipefail','-c',matrix+"\nprintf '%s\\n' \"${PHOTO_EXTRA_TESTS[@]}\""],{
   cwd:directory,encoding:'utf8',env:{...process.env,PHOTO_SCOPE:scope},stdio:'pipe'}).trim();
  assert.equal(run('catalog-photo-recovery-v1'),'');
  assert.deepEqual(run('catalog-photo-japan-power-v1').split('\n'),names);
  assert.throws(()=>run('unreviewed-scope'),error=>error.status===1);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
 const checks=workflow.split('\n').find(line=>line.includes('node --import tsx')&&line.includes('tests/catalog-photo-retry.test.ts'));
 for(const name of ['tests/catalog-photo-retry.test.ts','tests/photo-proxy.test.ts','tests/ajes-*.test.ts',
  'tests/catalog-detail-read-cache.test.ts','tests/catalog-japan-filter-rail.test.ts','tests/catalog-market-page-boundary.test.ts',
  '"${PHOTO_EXTRA_TESTS[@]}"','--import ./tests/helpers/offline-fetch.mjs'])assert.ok(checks.includes(name),name);
 assert.ok(workflow.indexOf('node tests/browser/photo-japan-recovery-clock.mjs')<workflow.indexOf(matrix));
 assert.ok(workflow.indexOf('npm run typecheck')>workflow.indexOf(checks));
 assert.ok(workflow.indexOf('node --import tsx tests/browser/catalog-photo-recovery.mjs')>workflow.indexOf('npm run typecheck'));
});
test('the pinned AJ removal preserves frozen gates and requires its exact scope and nonce handshake',()=>{
 const [workflow,entry]=[...customActivators][0],filename=path.join(workflowDirectory,workflow);
 if(!fs.existsSync(filename))return;
 const source=fs.readFileSync(filename,'utf8');
 assert.match(source,/verify-frozen-speed-baselines\.mjs/);
 assert.match(source,/release-speed-guard-contract\.test\.mjs/);
 assert.match(source,/ajes-japan-only-release\.test\.mjs/);
 assert.match(source,/ajes-japan-only-release-host\.test\.py/);
 assert.ok(source.includes(entry+' --activate '),'the registered exact AJ entry is required');
 const controller=fs.readFileSync(path.join(root,entry),'utf8');
 assert.match(controller,/assertRemovalReceipt\(await io\.removal\('private'\)/);
 assert.match(controller,/assertRemovalReceipt\(await io\.removal\('public'\)/);
 assert.match(controller,/assertBrowserReceipt\(await io\.browser\(\),nonce,profile\)/);
 assert.doesNotMatch(controller,/step\('server-(?:private|public)'/);
 const contract=fs.readFileSync(path.join(root,'.github/operations/ajes-japan-only-20261124/release-contract.mjs'),'utf8');
 assert.match(contract,/remove-unused-aj-outside-japan-v1/);
 assert.match(contract,/reviewedClosureChanges/);
 assert.match(contract,/calculationAlgorithmBlob/);
 assert.match(contract,/protectedClosureSha256/);
 assert.match(contract,/catalogPerformanceRevalidated===false/);
 assert.match(contract,/liveOwnerCrmVerified===false/);
 const host=fs.readFileSync(path.join(root,'.github/operations/ajes-japan-only-20261124/release-host.py'),'utf8');
 assert.match(host,/AVTOCENA_RELEASE_MARKETS': ''/);
 assert.match(host,/AVTOCENA_SPEED_BASELINE_MODE': 'enforce'/);
 assert.match(host,/len\(routes\) == 17/);
 assert.match(host,/wait_for_ui_verdict\(directory, SOURCE, self\.protocol\.nonce\)/);
 assert.match(host,/self\.require\('removal-private', 'removal-public', 'browser'\)/);
 assert.match(host,/driver\.emergency_rollback\(\)/);
 const ci=fs.readFileSync(path.join(workflowDirectory,'ci.yml'),'utf8');
 assert.match(ci,/^\s+node --test [^\n]*tests\/ajes-japan-only-release\.test\.mjs[^\n]*$/m);
 assert.match(ci,/^\s+python3 -I -B tests\/ajes-japan-only-release-host\.test\.py\s*$/m);
 for(const file of fs.readdirSync(workflowDirectory).filter(name=>/\.ya?ml$/.test(name))){
  const text=fs.readFileSync(path.join(workflowDirectory,file),'utf8');
  if(text.includes(entry+' --activate'))assert.equal(customActivators.get(file),entry,'unreviewed AJ activation entrypoint: '+file);
 }
});

test('the independent China activation binds source and generation to exact server and browser acceptance',()=>{
 const workflow='catalog-next-china-release.yml',entry=customActivators.get(workflow);
 const filename=path.join(workflowDirectory,workflow);
 if(!fs.existsSync(filename))return;
 const source=fs.readFileSync(filename,'utf8');
 const baseline=source.indexOf('node scripts/verify-frozen-speed-baselines.mjs');
 const contract=source.search(/^\s+node (?:--import tsx )?--test [^\n]*tests\/release-speed-guard-contract\.test\.mjs/m);
 const hostTests=source.indexOf('tests/catalog-next-*.test.mjs');
 const releaseAt=source.indexOf(entry);
 assert.ok(baseline>=0&&contract>=0&&hostTests>=0&&releaseAt>baseline&&releaseAt>contract&&releaseAt>hostTests,
  'the registered controller must follow frozen evidence, release contract and real host guard tests');
 const controller=fs.readFileSync(path.join(root,entry),'utf8');
 assert.match(controller,/verifyReadonlyInvocation\([\s\S]*operation: 'activate-china-generation'/);
 assert.match(controller,/verifyFrozenSpeedBaselines\(root\)/);
 assert.match(controller,/runtimeDiffSha256/);
 assert.match(controller,/expectedReceiptSha256: release\.receiptSha256/);
 assert.match(controller,/restored\.receipt\.binding\.generationManifestSha256 === release\.generationManifestSha256/);
 assert.match(controller,/generation\.source\.supplierLatestVerified === true/);
 const stages=["session.call('start')","session.call('functional')","session.call('speed')","session.call('switch')",
  "tests/browser/owner-filter-speed-live.mjs","scripts/catalog-next/browser-acceptance.mjs","session.call('accept'"];
 let previous=-1;
 for(const stage of stages){const at=controller.indexOf(stage);assert.ok(at>previous,'China acceptance order: '+stage);previous=at;}
 assert.match(controller,/browserCode === 0 && browser\.passed === true && browser\.browserPassed === true && browser\.speedGuard\?\.passed === true/);
 assert.match(controller,/nonce, passed: true, functionalPassed: true, speedPassed: true, reportSha256: hash\(Buffer\.concat\(\[browserRaw, detailsRaw\]\)\)/);
 assert.match(controller,/detailsCode === 0 && details\.passed === true && details\.release === plan\.runtimeSha && details\.nonce === nonce/);
 assert.match(controller,/details\.generationManifestSha256 === release\.generationManifestSha256 && details\.precedingSpeedReportSha256 === hash\(browserRaw\)/);
 assert.match(controller,/session\.abort\(\); await session\.exited/);
 const host=fs.readFileSync(path.join(root,'scripts/catalog-next/release-host.py'),'utf8');
 assert.match(host,/AVTOCENA_RELEASE_MARKETS': 'china'/);
 assert.match(host,/AVTOCENA_SPEED_BASELINE_MODE': 'enforce'/);
 assert.match(host,/self\.functional_passed and self\.speed_passed and not self\.switched/);
 assert.match(host,/self\.switched and self\.functional_passed and self\.speed_passed and not self\.accepted/);
 assert.match(host,/signal\.setitimer\(signal\.ITIMER_REAL, remaining\)/);
 assert.match(host,/self\.replace_config\(self\.proposed, self\.original\)/);
 assert.match(host,/cleanup_foreign_container/);
 const ssh=fs.readFileSync(path.join(root,'scripts/catalog-next/release-ssh.mjs'),'utf8');
 assert.match(ssh,/StrictHostKeyChecking=yes/);
 assert.match(ssh,/UserKnownHostsFile=/);
 assert.match(ssh,/hashlib\.sha256\(raw\)\.hexdigest\(\)/);
 for(const file of fs.readdirSync(workflowDirectory).filter(name=>/\.ya?ml$/.test(name))){
  const text=fs.readFileSync(path.join(workflowDirectory,file),'utf8');
  if(text.includes(entry))assert.equal(customActivators.get(file),entry,'unreviewed China activation entrypoint: '+file);
 }
 const ci=fs.readFileSync(path.join(workflowDirectory,'ci.yml'),'utf8');
 assert.match(ci,/node --import tsx --test tests\/catalog-next-\*\.test\.mjs/);
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

