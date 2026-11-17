import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {explain} from './safe-prepare-errors.mjs';
import {verifyPostfixRoots,POSTFIX_TREES} from './korea-postfix-source-guard.mjs';
import {validateActualFullpriceSamples} from './lib/validate-actual-fullprice-samples.mjs';
import {loadActualFullpriceRows,allowedActualFullpricePaths} from './lib/load-actual-fullprice-rows.mjs';
import {installFullpriceNetworkGuard} from './lib/full-price/network-guard.mjs';
import {assertFullpriceAcceptance} from './lib/full-price/acceptance.mjs';
import {installPriceSnapshot} from './lib/full-price/price-snapshot.mjs';
import {createAutomaticPriceProbe} from './lib/full-price/automatic-price-probe.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex'),hash=x=>sha(JSON.stringify(x));
const cwd=process.cwd(),out=path.resolve('korea-fullprice-audit.json'),log=console.log.bind(console),err=console.error.bind(console),originalFetch=globalThis.fetch;const originalConsole={...console};
let guard,snapshot,finalizeAttempted=false,stage='preflight',failure;const output={version:1,scope:'actual_saved_korea_16_four_cell_automatic_price_audit',publicationAcceptance:false,chinaActualAcceptance:false,supplierRequests:0,storageWrites:0};
const git=(root,args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
const verifyRoots=()=>verifyPostfixRoots(process.env,git);
const load=(root,file)=>import(pathToFileURL(path.join(root,file)).href);
try{
 verifyRoots();assert.equal(process.env.JSON_STORAGE_DRIVER,'object');assert.equal(process.env.YC_OBJECT_STORAGE_ENDPOINT,'https://s3.regru.cloud');assert.equal(process.env.YC_OBJECT_STORAGE_BUCKET,'avtocena-staging-8120751');assert.equal(process.env.YC_OBJECT_STORAGE_PREFIX,'migration-staging/full-20261011/');assert.notEqual(process.env.CATALOG_LIVE_RATE_DISABLED,'true');
 const manifest=JSON.parse(await fs.readFile(path.join(cwd,'actual-samples.json'),'utf8'));validateActualFullpriceSamples(manifest,await fs.readFile(path.resolve(process.env.POSTFIX_ACTUAL_REPORT)));
 const knowledgeRelease='83ff17075e9188dcf227c8752dc064248d5f42e0',knowledgeDigest='bf2c72cb7a260ef093c0a43c2b0dad9c4c9094a4d6dc3811dd0d7f7626b0d72b';
 guard=installFullpriceNetworkGuard({rawKeys:allowedActualFullpricePaths(manifest),knowledgeRelease,knowledgeDigest});globalThis.fetch=guard.fetch;
 // Source logging can contain provider text. Never forward it from this audit.
 for(const k of ['log','error','warn','info','debug'])console[k]=()=>{};
 const [{getJsonStorage},{validateCollectionControls},{collectionEnabled},{isEncarNonCashContract}]=await Promise.all([load(cwd,'apps/web/lib/data.ts'),load(cwd,'apps/web/lib/catalog/collection-controls.ts'),load(cwd,'apps/web/lib/catalog/collection-controls-schema.ts'),load(cwd,'apps/web/lib/catalog/encar-sale-contract.ts')]);
 const storage=getJsonStorage();assert.equal(storage.driver,'object');for(const k of ['writeJson','putBinary','deleteJson','deleteBinary','deleteObjects','deletePrefix','listObjects'])storage[k]=async()=>{await guard.fetch('https://invalid.invalid/forbidden',{method:'PUT'});};
 stage='saved_rows';const saved=await loadActualFullpriceRows({storage,manifest,controlsEnabled:v=>collectionEnabled(validateCollectionControls(v),'encar_feed'),admit:d=>d.advertisement_type==='Продажа'&&d.sales_status==='Доступно'&&!isEncarNonCashContract(d)&&Number(d.price)>0&&d.is_duplicate!==true});
 log(JSON.stringify({stage:'saved_rows_verified',rows:saved.rows.length}));
 const apps=[process.env.AUDIT_BEFORE_APP_ROOT,process.env.AUDIT_APP_ROOT],producers=[process.env.AUDIT_BEFORE_PRODUCER_ROOT,process.env.AUDIT_PRODUCER_ROOT];
 const scratch=await fs.mkdtemp(path.join(process.env.RUNNER_TEMP||os.tmpdir(),'korea-price-audit-'));
 stage='capture_context';snapshot=await installPriceSnapshot({appRoots:apps,expectedAppSources:[POSTFIX_TREES.AUDIT_BEFORE_APP_ROOT,POSTFIX_TREES.AUDIT_APP_ROOT],storage,authorizeStorageRead:guard.authorizeStorageRead,knowledgeRelease,knowledgeDigest,localDataRoot:path.join(scratch,'data')});
 const probes=await Promise.all(apps.map(root=>createAutomaticPriceProbe({runtimeRoot:root,sourcePins:snapshot.pinsByRoot[root],configContext:snapshot.configContext})));
 const normalizers=await Promise.all(producers.map(root=>load(root,'scripts/lib/paid-encar-offer.mjs'))),adapters=await Promise.all(apps.map(root=>load(root,'apps/web/lib/catalog/adapters.ts')));
 const descriptors=[];stage='automatic_four_cells';
 for(const [index,row] of saved.rows.entries())for(let producer=0;producer<2;producer++)for(let app=0;app<2;app++){
  const rawHash=hash(row.raw),data=structuredClone(row.raw.data);assert.equal(data.currency,'KRW');assert.ok(Number.isSafeInteger(Number(data.price))&&Number(data.price)>0);
  const offer=normalizers[producer].normalizePaidEncarOffer(data,{id:String(row.raw.inner_id),observedAt:row.observedAt,adapter:new adapters[app].EncarDirectAdapter()});assert.ok(offer,'fullprice_normalized_missing');offer.sourcePrice=Number(data.price);assert.equal(offer.market,'korea');assert.equal(offer.sourceCurrency,'KRW');
  await probes[app](offer);assert.equal(hash(row.raw),rawHash,'fullprice_raw_mutated');
  descriptors.push({coordinate:row.coordinate,rawSha256:rawHash,identitySha256:hash(String(row.raw.inner_id)),producer:producer?'after':'before',app:app?'after':'before',tags:manifest.entries.find(e=>e.coordinate.page===row.coordinate.page&&e.coordinate.row===row.coordinate.row).tags});
  if(app===1&&producer===1)log(JSON.stringify({stage:'automatic_row_verified',completed:index+1,total:saved.rows.length}));
 }
 stage='finalize';finalizeAttempted=true;await snapshot.finalize();assert.equal(snapshot.receipt().finalized,true);await saved.verify();guard.assertClean();verifyRoots();
 const accepted=snapshot.acceptedResults();assert.equal(accepted.length,64);assert.equal(descriptors.length,accepted.length);
 assert.ok(accepted.some(row=>row.fullPriceAccepted),'fullprice_no_accepted_rows');
 const joined=accepted.map((result,i)=>({...descriptors[i],result}));
 stage='final_price_acceptance';
 assertFullpriceAcceptance(joined);

 const comparisons=saved.rows.map(row=>{const cells=joined.filter(x=>x.coordinate.page===row.coordinate.page&&x.coordinate.row===row.coordinate.row),before=cells.find(x=>x.producer==='before'&&x.app==='before').result,after=cells.find(x=>x.producer==='after'&&x.app==='after').result;return {coordinate:row.coordinate,rawSha256:hash(row.raw),bothAccepted:before.fullPriceAccepted&&after.fullPriceAccepted,totalDeltaRub:before.totalRub!==null&&after.totalRub!==null?after.totalRub-before.totalRub:null,beforeAgeBand:before.customs.ageBand,afterAgeBand:after.customs.ageBand,beforeStatus:before.status,afterStatus:after.status};});
 Object.assign(output,{passed:true,auditExecutionComplete:true,allPricesAccepted:accepted.every(row=>row.fullPriceAccepted),comparisons,sourceSha:process.env.GITHUB_SHA,treePins:POSTFIX_TREES,sampleManifestSha256:hash(manifest),sourceReportByteSha256:manifest.sourceReportByteSha256,checks:saved.checks,context:snapshot.receipt(),priceSourcePins:snapshot.pinsByRoot,network:guard.receipt(),rows:joined,missingObservedStrata:['missing_manufacture_date'],chinaControl:'not_in_this_bounded_korea_run'});
}catch(error){failure=error;}
finally{
 if(snapshot&&!finalizeAttempted){finalizeAttempted=true;try{await snapshot.finalize();}catch(error){failure??=error;}}
 globalThis.fetch=originalFetch;guard?.restore();Object.assign(console,originalConsole);process.chdir(cwd);
}
if(failure){err(JSON.stringify({stage,passed:false,safeError:explain(failure),acceptanceFailure:['fullprice_complete_arithmetic_rejected','fullprice_control_cells_missing','fullprice_control_not_accepted','fullprice_unchanged_control_total_changed','fullprice_no_accepted_rows'].find(code=>String(failure.message).includes(code))||null,network:guard?.receipt(),contextFinalized:snapshot?.receipt().finalized===true}));process.exitCode=1;}
else {await fs.writeFile(out,JSON.stringify(output,null,2));log(JSON.stringify({stage:'fullprice_complete',passed:true,rows:output.rows.length,fullPriceAcceptedRows:output.rows.filter(x=>x.result.fullPriceAccepted).length,publicationAcceptance:false}));}
