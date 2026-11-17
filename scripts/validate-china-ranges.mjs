import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import{execFileSync}from'node:child_process';import http from'node:http';import https from'node:https';import{syncBuiltinESMExports}from'node:module';
import{downloadRanges,signRead}from'./range-download.mjs';
const EXPECTED_SOURCE='c7e00f72292573dde4c892a2038a65e65d5b7066',KEY='catalog/generations/gen_1794878284419_a611dfcf/indexes/projection/china.json',LENGTH=531368566,SHA='0a305079d638a5ffc30294e2bc03d83d5d030cf845a463e6559bfffd7c4a8d58';
const BASE='https://s3.regru.cloud/avtocena-staging-8120751/migration-staging/full-20261011/',url=new URL(BASE+KEY),root=path.resolve(process.env.CANDIDATE_ROOT||'.'),output=path.resolve(process.env.RANGE_VALIDATION_REPORT||'china-range-validation.json');
const started=Date.now();let written=false,completed=null;const report={version:1,source:EXPECTED_SOURCE,key:KEY,expectedBytes:LENGTH,expectedSha256:SHA,passed:false,supplierRequests:0,storageWrites:0,networkRequests:0};
const known=new Set(JSON.parse(await fs.readFile(new URL('./range-error-codes.json',import.meta.url),'utf8')));
async function finish(){if(written)return;written=true;report.elapsedMs=Date.now()-started;await fs.writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
const watchdog=setTimeout(()=>{report.error='range_watchdog';void finish().finally(()=>process.exit(2));},905000);
try{
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),EXPECTED_SOURCE);
 assert.equal(execFileSync('git',['diff','--name-only','HEAD','--','apps/web/lib','packages','scripts'],{cwd:root,encoding:'utf8'}).trim(),'');
 assert.equal(process.env.YC_OBJECT_STORAGE_ENDPOINT,'https://s3.regru.cloud');assert.equal(process.env.YC_OBJECT_STORAGE_BUCKET,'avtocena-staging-8120751');assert.equal(process.env.YC_OBJECT_STORAGE_PREFIX,'migration-staging/full-20261011/');
 const {installCandidateBudgetNetworkFence}=await import(path.join(root,'scripts/catalog-candidate-budget-prepare.mjs'));
 installCandidateBudgetNetworkFence(process.env,globalThis.fetch,null,false);const fenced=globalThis.fetch;
 globalThis.fetch=async(input,options={})=>{
  const u=new URL(typeof input==='string'||input instanceof URL?input:input.url),method=options.method||input.method||'GET',h=new Headers(options.headers??input.headers);
  if(u.href!==url.href||!['GET','HEAD'].includes(method)||options.body!=null||input.body!=null||options.redirect!=='error')throw Error('range_validation_request_forbidden');
  if(report.networkRequests>=194)throw Error('range_request_quota');
  if(method==='GET'){const m=/^bytes=(\d+)-(\d+)$/.exec(h.get('range')||'');if(!m||Number(m[1])>Number(m[2])||Number(m[2])>=LENGTH||Number(m[2])-Number(m[1])+1>8*1024**2||!/^"[^"\r\n]+"$/.test(h.get('if-match')||''))throw Error('range_validation_request_forbidden');}
  report.networkRequests++;return fenced(input,options);
 };
 for(const module of [http,https])for(const method of ['get','request'])module[method]=()=>{throw Error('range_native_transport_forbidden');};syncBuiltinESMExports();
 const request=(method,headers,signal)=>fetch(url,{method,headers:signRead(url,method,process.env,headers),signal,redirect:'error'});
 completed=await downloadRanges({request,directory:path.join(process.env.RUNNER_TEMP||'/tmp','china-range-validation'),chunkBytes:8*1024**2,concurrency:4,maxAttempts:3,deadlineMs:Math.max(1,900000-(Date.now()-started)),partTimeoutMs:120000,maxBytes:640*1024**2,maxChunks:64,maxRequests:194,expectedLength:LENGTH,expectedSha256:SHA});
 report.actualBytes=completed.length;report.actualSha256=completed.sha256;report.metrics=completed.metrics;report.streamComplete=true;report.passed=true;await finish();
}catch(error){report.error=known.has(error.message)?error.message:error.name==='AssertionError'?'range_validation_assertion':'range_validation_unknown';await finish();process.exitCode=1;}
finally{clearTimeout(watchdog);if(completed)await fs.rm(completed.path,{force:true});}
