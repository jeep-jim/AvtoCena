import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {PROFILE,ACCEPTANCE,sha256,need,verifySource,verifyGates,assertBrowserReceipt} from './release-contract.mjs';
import {createResourceNodeInvocation,forwardResourceNodeTelemetry} from '../../../scripts/lib/node-resource-memory.mjs';

const FIXTURE='tests/browser/collection-controls.mjs';
const WIDTHS=[390,1440];
const PNG=Buffer.from('89504e470d0a1a0a','hex');

/** This proof is explicitly an isolated render of the exact owner component.
 * It is not an authenticated visit to production and makes no catalog speed claim. */
export function fixtureReport({stdout,exitCode,sourceProof,fixtureSha256,screenshots},profile=PROFILE){
  need(exitCode===0&&sourceProof?.clean===true&&sourceProof.acceptance===ACCEPTANCE
    &&sourceProof.source===profile.source&&sourceProof.tree===profile.tree
    &&sourceProof.codeDiffSha256===profile.codeDiffSha256
    &&sourceProof.protectedClosureSha256===profile.protectedClosureSha256,'ui_fixture_source');
  const completed=String(stdout).split('\n').filter(line=>/^Owner controls \d+: passed$/.test(line))
    .map(line=>Number(line.match(/\d+/)[0])).sort((a,b)=>a-b);
  need(JSON.stringify(completed)===JSON.stringify(WIDTHS),'ui_fixture_coverage');
  need(/^[a-f0-9]{64}$/.test(fixtureSha256)&&Array.isArray(screenshots)&&screenshots.length===2
    &&screenshots.every((row,index)=>row.width===WIDTHS[index]&&/^[a-f0-9]{64}$/.test(row.sha256)
      &&Number.isSafeInteger(row.bytes)&&row.bytes>8&&row.bytes<=16*1024*1024),'ui_fixture_screenshots');
  return {schemaVersion:1,acceptance:ACCEPTANCE,kind:'isolated-owner-ui',release:profile.source,tree:profile.tree,
    codeDiffSha256:profile.codeDiffSha256,protectedClosureSha256:profile.protectedClosureSha256,
    passed:true,uiPassed:true,retiredSourcesAbsent:true,japanFormPreserved:true,retiredRequests:0,widths:WIDTHS,
    liveOwnerCrmVerified:false,catalogPerformanceRevalidated:false,fixtureSha256,screenshots};
}

export function browserVerdict({raw,exitCode,nonce},profile=PROFILE){
  need(exitCode===0&&/^[a-f0-9]{32}$/.test(nonce),'browser_fixture_failed');
  const report=JSON.parse(raw);
  const {fixtureSha256,screenshots,...receipt}=report;
  need(/^[a-f0-9]{64}$/.test(fixtureSha256)&&Array.isArray(screenshots)&&screenshots.length===2,'browser_fixture_report');
  return assertBrowserReceipt({...receipt,nonce,reportSha256:sha256(raw)},nonce,profile);
}

export function failedBrowserVerdict(nonce,profile=PROFILE){
  return {schemaVersion:1,acceptance:ACCEPTANCE,kind:'isolated-owner-ui',release:profile.source,tree:profile.tree,
    codeDiffSha256:profile.codeDiffSha256,protectedClosureSha256:profile.protectedClosureSha256,nonce,
    passed:false,uiPassed:false,retiredSourcesAbsent:false,japanFormPreserved:false,retiredRequests:0,widths:WIDTHS,
    liveOwnerCrmVerified:false,catalogPerformanceRevalidated:false,reportSha256:sha256('{}')};
}

export async function runBrowserGate({root,sourceRoot,directory,nonce}){
  verifyGates(root);const sourceProof=verifySource(sourceRoot);
  const browserRoot=path.join(directory,'browser');await fs.mkdir(browserRoot,{mode:0o700});
  const fixtureOutput=path.join(sourceRoot,'artifacts/collection-controls');
  let present=true;try{await fs.lstat(fixtureOutput);}catch(error){if(error.code==='ENOENT')present=false;else throw error;}
  need(!present,'ui_fixture_output_exists');
  const fixtureSha256=sha256(await fs.readFile(path.join(sourceRoot,FIXTURE)));
  const modulePath=path.join(await fs.realpath(process.env.RUNNER_TEMP),'release-browser/node_modules/playwright/index.mjs');
  need(await fs.realpath(process.env.CHROME_BIN)===process.env.CHROME_BIN,'browser_binary');
  // No storage credentials, owner cookies, supplier access or production writes
  // enter the component fixture. Its CRM APIs are local test responses.
  const env={PATH:'/usr/bin:/bin',LANG:'C.UTF-8',CHROME_BIN:process.env.CHROME_BIN,PLAYWRIGHT_MODULE:modulePath};
  const invocation=await createResourceNodeInvocation({args:['--import','tsx',FIXTURE],env,role:'aj-removal-ui-fixture'});
  const logPath=path.join(browserRoot,'private.log'),log=await fs.open(logPath,'wx',0o600);let code;
  try{
    code=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,invocation.args,{cwd:sourceRoot,env:invocation.env,stdio:['ignore',log.fd,log.fd]});
      const timer=setTimeout(()=>child.kill('SIGTERM'),300000);
      child.once('error',()=>{clearTimeout(timer);reject(Error('aj_release_browser_process'));});
      child.once('close',status=>{clearTimeout(timer);resolve(status);});
    });
  }finally{await log.close();}
  need((await fs.stat(logPath)).size<=8*1024*1024,'ui_fixture_log_bound');
  const stdout=await fs.readFile(logPath,'utf8');forwardResourceNodeTelemetry(stdout);
  need(code===0,'ui_fixture_failed');
  const retainedOutput=path.join(browserRoot,'fixture');await fs.rename(fixtureOutput,retainedOutput);
  // Remove only the now-empty fixture parent, never an unrelated output.
  await fs.rmdir(path.join(sourceRoot,'artifacts')).catch(error=>{if(error.code!=='ENOTEMPTY')throw error;});
  verifySource(sourceRoot);
  const screenshots=[];
  for(const width of WIDTHS){
    const raw=await fs.readFile(path.join(retainedOutput,'controls-'+width+'.png'));
    need(raw.length<=16*1024*1024&&raw.subarray(0,8).equals(PNG),'ui_fixture_png');
    screenshots.push({width,bytes:raw.length,sha256:sha256(raw)});
  }
  const raw=JSON.stringify(fixtureReport({stdout,exitCode:code,sourceProof,fixtureSha256,screenshots}),null,2)+'\n';
  await fs.writeFile(path.join(browserRoot,'owner-ui-report.json'),raw,{mode:0o600,flag:'wx'});
  return browserVerdict({raw,exitCode:code,nonce});
}
