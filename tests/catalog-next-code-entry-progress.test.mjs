import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const entry = fileURLToPath(new URL('../scripts/catalog-next/code-entry.mjs', import.meta.url));
const phase = 'code_japan_report_observed', sha256 = 'a'.repeat(64);

// Execute the unchanged entrypoint source, including its real local progress
// wrapper and CLI stdout. Only imported external capabilities are replaced;
// no release, network access, git mutation or real report write is possible.
const harness = String.raw`
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import vm from 'node:vm';
const entry=process.argv[1],input=JSON.parse(readFileSync(0,'utf8'));
const logs=[],calls=[],writes=[],getterReads={};
const runtimeSha='b'.repeat(40),runtimeTree='c'.repeat(40),retainedRuntime='d'.repeat(40);
const pricingRuntimeSha='e'.repeat(40),pricingRuntimeTree='f'.repeat(40),controllerSha='9'.repeat(40);
const environment={GITHUB_WORKFLOW_REF:'jeep-jim/AvtoCena/.github/workflows/catalog-next-china-photo-release.yml@refs/heads/main',
  GITHUB_JOB:'release',JSON_STORAGE_DRIVER:'object',RUNNER_TEMP:'/fixture-runner',GITHUB_RUN_ID:'1',GITHUB_RUN_ATTEMPT:'1'};
const plans={
  'china-plan.json':{runtimeSha:pricingRuntimeSha,runtimeTree:pricingRuntimeTree},
  'china-code-serving-plan.json':{runtimeSha,runtimeTree,retainedRuntime,pricingRuntimeSha,pricingRuntimeTree},
  'china-serving-plan.json':{runtimeSha:retainedRuntime},
  'image-receipt.json':{runtimeSha,runtimeTree,archiveRoundTripVerified:true,imageId:'sha256:'+'1'.repeat(64)},
};
const fixtureFs={async realpath(value){return value;},async readFile(value){
  const name=path.basename(value);assert(Object.hasOwn(plans,name),'unexpected file read');
  return Buffer.from(JSON.stringify(plans[name]));
},async writeFile(value,raw){
  assert.equal(path.basename(value),'catalog-next-china-photo-release-report.json');writes.push(JSON.parse(raw));
}};
const rows=items=>(items||[]).map(value=>{
  if(!value.accessors)return value;
  const row={phase:value.phase};
  for(const key of ['bytes','exitCode','sha256'])Object.defineProperty(row,key,{enumerable:true,get(){
    getterReads[key]=(getterReads[key]||0)+1;
    return getterReads[key]===1?value[key]:'PRIVATE_SECOND_READ';
  }});
  return row;
});
const mocks={
  'node:fs/promises':{default:fixtureFs},'node:path':{default:path},'node:url':{fileURLToPath},
  '../lib/readonly-marker-invocation.mjs':{verifyReadonlyInvocation({operation}){
    assert.equal(operation,'activate-china-photo-code');calls.push('invocation');return {sourceSha:controllerSha};
  }},
  '../verify-frozen-speed-baselines.mjs':{verifyFrozenSpeedBaselines(){calls.push('baselines');}},
  './daily-entry.mjs':{checkoutChinaDailyRuntimes(){assert.fail('checkout forbidden');}},
  './build-release-image.mjs':{buildChinaReleaseImage(){assert.fail('build forbidden');}},
  './photo-code-scope.mjs':{verifyChinaPhotoCodeRuntime(){calls.push('scope');return {frozenHttpOracleReusable:true,retainedRuntime};}},
  './daily-release.mjs':{createChinaDailyRelease({onProgress}){calls.push('release-adapter');return {
    async stageCodeRelease(){calls.push('stage');for(const row of rows(input.daily))await onProgress(row);
      if(input.errorCode)throw Error(input.errorCode);
    },recoverRelease(){assert.fail('unexpected recovery');},retireHost(){assert.fail('unexpected retire');},
    retireTerminalAppImage(){assert.fail('unexpected cleanup');},
  };}},
  './china-state.mjs':{createChinaStateStorage({retryTransientReads}){assert.equal(retryTransientReads,true);calls.push('storage');return {};},
    checkedChinaStateStorageFailure(){throw Error('absent fixture storage failure');}},
  './code-controller.mjs':{async runChinaCodeCycle(options){calls.push('cycle');
    await options.stageCodeRelease();for(const row of rows(input.cycle))await options.onProgress(row);
    return {version:1,kind:'china-code-cycle-v1',market:'china',completed:true,published:true,status:'accepted'};
  }},
};
const localProcess={argv:[process.execPath,entry,'--run'],env:environment,exitCode:0,
  stdout:{write:value=>logs.push(String(value))}};
const context=vm.createContext({process:localProcess,Buffer,URL});
const module=new vm.SourceTextModule(readFileSync(entry,'utf8'),{context,identifier:pathToFileURL(entry).href,
  initializeImportMeta:meta=>{meta.url=pathToFileURL(entry).href;},
  importModuleDynamically:()=>assert.fail('dynamic capability import forbidden'),
});
await module.link(async specifier=>{
  assert(Object.hasOwn(mocks,specifier),'unmocked capability '+specifier);
  const exports=mocks[specifier];return new vm.SyntheticModule(Object.keys(exports),function(){
    for(const [name,value]of Object.entries(exports))this.setExport(name,value);
  },{context});
});
await module.evaluate();
process.stdout.write(JSON.stringify({logs:logs.map(value=>JSON.parse(value)),calls,writes,getterReads,exitCode:localProcess.exitCode}));
`;

function run(input) {
  const raw = execFileSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', harness, entry],
    {input: JSON.stringify(input), encoding: 'utf8', timeout: 10_000, maxBuffer: 128 * 1024,
      stdio: ['pipe', 'pipe', 'pipe']});
  return JSON.parse(raw);
}

test('actual entry wrapper forwards oversize report observations before the normal binding failure without leaking content', () => {
  const result = run({daily: [{phase, bytes: 131073, exitCode: 1, sha256,
    market: 'PRIVATE_MARKET', applicationBuilds: 99, generationBytes: 7, availableDiskBytes: 8, neededBytes: 9,
    raw: 'PRIVATE_JSON', sql: 'PRIVATE_SQL', error: {stage: 'PRIVATE_STAGE'}, path: 'PRIVATE_PATH',
    nonce: 'PRIVATE_NONCE', supplierUrl: 'PRIVATE_ENDPOINT', visitorIp: 'PRIVATE_IP'}],
    errorCode: 'china_daily_release_japan_browser_binding'});
  assert.deepEqual(result.logs[0], {phase, market: 'china', bytes: 131073, exitCode: 1, sha256});
  assert.equal(result.logs[1].errorCode, 'china_daily_release_japan_browser_binding');
  assert.equal(result.logs[1].completed, false); assert.equal(result.logs[1].published, false);
  assert.deepEqual(result.logs[2], {phase: 'photo_code_failed', errorCode: 'china_daily_release_japan_browser_binding'});
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.calls, ['invocation', 'baselines', 'scope', 'release-adapter', 'storage', 'cycle', 'stage']);
  assert.doesNotMatch(JSON.stringify(result.logs), /PRIVATE_|raw|supplierUrl|visitorIp|nonce|generationBytes|availableDiskBytes|neededBytes/);
});

test('the same wrapper accepts bounded scalar observations from both adapter and cycle callbacks', () => {
  const result = run({daily: [{phase, bytes: 0, exitCode: null, sha256}],
    cycle: [{phase, bytes: Number.MAX_SAFE_INTEGER, exitCode: 255, sha256}]});
  assert.deepEqual(result.logs.slice(0, 2), [
    {phase, market: 'china', bytes: 0, exitCode: null, sha256},
    {phase, market: 'china', bytes: Number.MAX_SAFE_INTEGER, exitCode: 255, sha256},
  ]);
  assert.equal(result.exitCode, 0); assert.equal(result.writes[0].status, 'accepted');
});

test('malformed observation scalars are omitted as a whole instead of partially logging an unbound record', () => {
  const changes = [{bytes: -1}, {bytes: 1.5}, {bytes: 'PRIVATE_BYTES'}, {bytes: Number.MAX_SAFE_INTEGER + 1},
    {bytes: null}, {exitCode: -1}, {exitCode: 256}, {exitCode: 1.5}, {exitCode: 'PRIVATE_EXIT'},
    {sha256: 'A'.repeat(64)}, {sha256: 'a'.repeat(65)}, {sha256: 'PRIVATE_DIGEST'},
    {sha256: {private: 'PRIVATE_OBJECT'}}, {sha256: undefined}];
  const result = run({daily: changes.map(change => ({phase, bytes: 123, exitCode: 1, sha256, ...change}))});
  assert.deepEqual(result.logs.slice(0, changes.length), changes.map(() => ({phase, market: 'china'})));
  assert.doesNotMatch(JSON.stringify(result.logs), /PRIVATE_|bytes|exitCode|sha256/);
});

test('observed-report fields never escape through a different phase and existing capacity progress is preserved', () => {
  const result = run({daily: [{phase: 'code_capacity_checked', market: 'PRIVATE_MARKET',
    generationBytes: 1, availableDiskBytes: 2, neededBytes: 3, bytes: 131073, exitCode: 1, sha256},
    {phase: 'code_japan_report_observed_extra', bytes: 131073, exitCode: 1, sha256},
    {phase: 'PRIVATE PHASE', bytes: 131073, exitCode: 1, sha256}, {phase: 1}]});
  assert.deepEqual(result.logs.slice(0, -1), [
    {phase: 'code_capacity_checked', market: 'china', generationBytes: 1, availableDiskBytes: 2, neededBytes: 3},
    {phase: 'code_japan_report_observed_extra', market: 'china'},
  ]);
});

test('the observed scalars are snapshotted once before validation and cannot change into private strings while logged', () => {
  const result = run({daily: [{phase, bytes: 131073, exitCode: 1, sha256, accessors: true}]});
  assert.deepEqual(result.logs[0], {phase, market: 'china', bytes: 131073, exitCode: 1, sha256});
  assert.deepEqual(result.getterReads, {bytes: 1, exitCode: 1, sha256: 1});
  assert.doesNotMatch(JSON.stringify(result.logs), /PRIVATE_/);
});
