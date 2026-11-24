import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {PROFILE,sha256,need} from './release-contract.mjs';
import {GATE_FILES} from '../home-ui-only-20261123/contract.mjs';
import {createResourceNodeInvocation,forwardResourceNodeTelemetry} from '../../../scripts/lib/node-resource-memory.mjs';

const FILES=['tests/browser/owner-filter-speed-live.mjs','scripts/lib/accepted-browser-speed.mjs',
  'docs/operations/2026-11-11-accepted-browser-speed-baseline.json'];

export function browserVerdict({raw,exitCode,nonce}){
  const value=JSON.parse(raw);
  need(/^[a-f0-9]{32}$/.test(nonce),'browser_nonce');
  const passed=exitCode===0&&value.release===PROFILE.source&&value.phase==='release-required-browser-gate'
    &&value.passed===true&&value.browserPassed===true&&value.speedGuard?.passed===true;
  return {schemaVersion:1,release:PROFILE.source,nonce,passed,functionalPassed:passed,speedPassed:passed,reportSha256:sha256(raw)};
}

export async function runBrowserGate({root,directory,nonce}){
  const browserRoot=path.join(directory,'browser');await fs.mkdir(browserRoot,{mode:0o700});
  for(const name of FILES){
    const raw=await fs.readFile(path.join(root,name));need(sha256(raw)===GATE_FILES[name],'browser_source');
    await fs.mkdir(path.dirname(path.join(browserRoot,name)),{recursive:true,mode:0o700});
    await fs.writeFile(path.join(browserRoot,name),raw,{mode:0o400,flag:'wx'});
  }
  const marker=path.join(browserRoot,'marker.json');
  await fs.writeFile(marker,JSON.stringify({release:PROFILE.source,phase:'release-required-browser-gate',
    verifyPartnerBudgets:false,enforceSpeed:true}),{mode:0o400,flag:'wx'});
  const modulePath=path.join(await fs.realpath(process.env.RUNNER_TEMP),'release-browser/node_modules/playwright/index.mjs');
  need(await fs.realpath(process.env.CHROME_BIN)===process.env.CHROME_BIN,'browser_binary');
  const env={PATH:'/usr/bin:/bin',LANG:'C.UTF-8',CHROME_BIN:process.env.CHROME_BIN,PLAYWRIGHT_MODULE:modulePath,OWNER_FILTER_BROWSER_MARKER:marker};
  const invocation=await createResourceNodeInvocation({args:[path.join(browserRoot,FILES[0])],env,role:'aj-japan-browser'});
  const log=await fs.open(path.join(browserRoot,'private.log'),'wx',0o600);let code;
  try{
    code=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,invocation.args,{cwd:browserRoot,env:invocation.env,stdio:['ignore',log.fd,log.fd]});
      const timer=setTimeout(()=>child.kill('SIGTERM'),300000);
      child.once('error',()=>{clearTimeout(timer);reject(Error('aj_release_browser_process'));});
      child.once('close',status=>{clearTimeout(timer);resolve(status);});
    });
  }finally{await log.close();}
  forwardResourceNodeTelemetry(await fs.readFile(path.join(browserRoot,'private.log'),'utf8'));
  return browserVerdict({raw:await fs.readFile(path.join(browserRoot,'owner-filter-browser-report.json'),'utf8'),exitCode:code,nonce});
}
