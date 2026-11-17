import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import assert from 'node:assert/strict';import http from 'node:http';import https from 'node:https';import {syncBuiltinESMExports} from 'node:module';
import {explain} from './safe-prepare-errors.mjs';
import {allowedAuditPaths,auditSavedPages} from './lib/korea-saved-path-audit.mjs';
import {createKoreaRowInspector,CALC_PATH_FILES} from './lib/korea-calc-path-audit.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex'),paths=allowedAuditPaths(),start=Date.now(),deadline=start+20*60000;let forbidden=0,requests=0;
const deny=()=>{forbidden++;throw Error('saved_audit_forbidden');};
try{
 const source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();assert.equal(source,process.env.GITHUB_SHA);assert.equal(execFileSync('git',['diff','--name-only','HEAD'],{encoding:'utf8'}).trim(),'');
 assert.equal(process.env.JSON_STORAGE_DRIVER,'object');assert.equal(process.env.YC_OBJECT_STORAGE_ENDPOINT,'https://s3.regru.cloud');assert.equal(process.env.YC_OBJECT_STORAGE_BUCKET,'avtocena-staging-8120751');assert.equal(process.env.YC_OBJECT_STORAGE_PREFIX,'migration-staging/full-20261011/');
 const originalFetch=globalThis.fetch.bind(globalThis),prefix='/avtocena-staging-8120751/migration-staging/full-20261011/';
 globalThis.fetch=(input,options={})=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url),method=String(options.method||input?.method||'GET').toUpperCase();
  if(!['GET','HEAD'].includes(method)||url.origin!=='https://s3.regru.cloud'||url.username||url.password||url.search||url.hash||!url.pathname.startsWith(prefix)||!paths.has(decodeURIComponent(url.pathname.slice(prefix.length)))||++requests>320||Date.now()>=deadline)return deny();
  const signal=AbortSignal.timeout(Math.max(1,deadline-Date.now()));return originalFetch(input,{...options,redirect:'error',signal:options.signal?AbortSignal.any([options.signal,signal]):signal});};
 for(const module of [http,https])for(const key of ['request','get'])module[key]=deny;syncBuiltinESMExports();
 const [{getJsonStorage},{validateCollectionControls},{collectionEnabled},{isEncarNonCashContract}]=await Promise.all([import('../apps/web/lib/data.ts'),import('../apps/web/lib/catalog/collection-controls.ts'),import('../apps/web/lib/catalog/collection-controls-schema.ts'),import('../apps/web/lib/catalog/encar-sale-contract.ts')]);
 const storage=getJsonStorage();assert.equal(storage.driver,'object');for(const key of ['writeJson','putBinary','deleteJson','deleteBinary','deleteObjects','deletePrefix'])storage[key]=async()=>deny();
 const pins={};for(const file of CALC_PATH_FILES){const body=await fs.readFile(path.resolve(file));assert.equal(sha(body),sha(execFileSync('git',['show',source+':'+file])));pins[file]=sha(body);}
 const engineContext={customsValueRub:1000000,eurRateRub:100,importedAt:'2026-11-17'};
 const inspect=await createKoreaRowInspector({runtimeRoot:process.cwd(),sourcePins:pins,engineContext});
 const inspectRow=async(...args)=>{try{return await inspect(...args);}catch(error){return {stratum:'unknown',issues:['NORMALIZATION_OR_ENGINE_EXCEPTION'],technical:{admitted:true,failed:true},safeError:explain(error)};}};
 const report=await auditSavedPages({storage:{readJson:async(key,fallback)=>{if(!paths.has(key))return deny();return storage.readJson(key,fallback);}},inspectRow,
  controlsEnabled:v=>collectionEnabled(validateCollectionControls(v),'encar_feed'),
  admit:d=>d.advertisement_type==='Продажа'&&d.sales_status==='Доступно'&&!isEncarNonCashContract(d)&&Number(d.price)>0&&d.is_duplicate!==true});
 assert.equal(forbidden,0);for(const file of CALC_PATH_FILES)assert.equal(sha(await fs.readFile(file)),pins[file]);
 const result={...report,sourceSha:source,sourcePins:pins,engineContext,engineContextMeaning:'isolated_shared_customs_input_probe_not_live_delivered_quote',requests,elapsedMs:Date.now()-start};
 await fs.writeFile('korea-saved-path-audit.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error(JSON.stringify({stage:'korea_saved_path_audit_failed',requests,forbidden,safeError:explain(error)}));process.exitCode=1;}
