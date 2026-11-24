import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {getJsonStorage} from '../../apps/web/lib/data.ts';
import {verifyReadonlyInvocation} from '../lib/readonly-marker-invocation.mjs';
import {RAW_PIN_PREFIX,rawDigest,rawProducerOwner} from '../lib/catalog-raw-provenance.mjs';
import {validateIntakeArchive,receiptFromReadyPin,verifyIntakeArchive} from '../lib/nonjp-intake-archive.mjs';
import {marketPolicy} from './market-policy.mjs';
import {buildSavedChinaSource} from './saved-china-source.mjs';
import {savePrivateChinaSource} from './private-source-output.mjs';
import {chinaSourceOutputRoot} from './private-source-output.mjs';
import {createPrivateChinaStorage} from './private-storage.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const headKey='catalog/owned-feed/v1/china/prepared.json';
const markerPath='.github/market-runs/catalog-next-china.json';
const output=path.resolve(process.env.CATALOG_NEXT_REPORT??'catalog-next-china-report.json');
const report={version:1,market:'china',phase:'invocation',completed:false,published:false,
  sourceApiCalls:0,liveCatalogWrites:0,encyclopediaWrites:0,calculatorChanges:0,deletions:0};
let phase='invocation';
const progress=value=>console.log(JSON.stringify(value));
const failCode=error=>/^[a-z][a-z0-9_]{2,119}$/.test(error?.message??'')?error.message:'china_preparation_failed';
try {
  // This helper verifies the checked-out Git source with read-only Git calls;
  // storage writes below are explicitly restricted to a new private source.
  const invocation=verifyReadonlyInvocation({root,markerPath,operation:'prepare-china-saved-source'});
  report.sourceSha=invocation.sourceSha;
  const owner=rawProducerOwner(),policy=marketPolicy('china');
  assert(policy.minimumYear===2014&&policy.provider==='auto_api'&&policy.source==='che168','china_source_policy');
  for(const [name,value] of Object.entries({JSON_STORAGE_DRIVER:'object',YC_OBJECT_STORAGE_ENDPOINT:'https://s3.regru.cloud',
    YC_OBJECT_STORAGE_BUCKET:'avtocena-staging-8120751',YC_OBJECT_STORAGE_PREFIX:'migration-staging/full-20261011/'})) {
    assert.equal(process.env[name],value,'china_source_storage_configuration');
  }
  const storage=getJsonStorage();
  phase='capture_saved_source';
  const captured=await storage.readJsonWithMeta(headKey,null),head=captured.value;
  assert(captured.found&&typeof captured.etag==='string'&&captured.etag&&head?.version===1&&head.market==='china'&&
    /^[1-9]\d{0,19}$/.test(head.runId??'')&&Number.isSafeInteger(head.cursor)&&head.cursor>=0&&
    Number.isSafeInteger(head.observations)&&head.observations>0&&/^[a-f0-9]{64}$/.test(head.archiveSha256??'')&&
    /^catalog\/nonjp-intake\/v1\/china\/[1-9]\d{0,19}\/[1-9]\d{0,5}$/.test(head.archiveRoot??''),'china_saved_source_head');
  let lastCheck=0,downloadCutKey,downloadCutSha256;
  const assertCurrent=async(force=false)=>{
    if(!force&&Date.now()-lastCheck<10000)return;
    const current=await storage.readJsonWithMeta(headKey,null);
    assert(current.found&&current.etag===captured.etag&&rawDigest(current.value)===rawDigest(head),'china_saved_source_changed');
    if(force&&downloadCutKey)assert.equal(rawDigest(await storage.readJson(downloadCutKey,null)),downloadCutSha256,'china_saved_download_changed');
    lastCheck=Date.now();
  };
  const saved=validateIntakeArchive(await storage.readJson(head.archiveRoot+'/complete.json',null),head.archiveRoot,head.archiveSha256);
  assert(saved.collection.complete===true&&saved.market==='china','china_saved_archive_incomplete');
  const pinKey=RAW_PIN_PREFIX+`nonjp-intake-china-${saved.owner.runId}-${saved.owner.attempt}.json`;
  const archive=receiptFromReadyPin({market:'china',owner:saved.owner,root:head.archiveRoot,manifest:saved,
    pin:await storage.readJson(pinKey,null)});
  downloadCutKey=`catalog/owned-feed/v1/china/runs/${head.runId}/complete.json`;
  const downloadCut=await storage.readJson(downloadCutKey,null);downloadCutSha256=rawDigest(downloadCut);
  const scratch=await fs.mkdtemp(path.join(process.env.RUNNER_TEMP??'/tmp','catalog-next-china-'));
  const space=await fs.statfs(scratch),available=space.bavail*space.bsize;
  // Restored bytes, SQLite/raw payloads, private ledger and transport headroom.
  assert(available>saved.totalBytes*4+256*1024**2,'china_saved_source_disk_reserve');
  report.archiveBytes=saved.totalBytes;report.savedSourceRows=head.observations;
  report.minimumYear=policy.minimumYear;
  progress({phase,rows:head.observations,archiveBytes:saved.totalBytes,minimumYear:policy.minimumYear,published:false});
  phase='restore_saved_archive';
  const inputDirectory=path.join(scratch,'input'),outputDirectory=path.join(scratch,'source');
  const manifest=await verifyIntakeArchive({storage,receipt:archive,directory:inputDirectory,readerOwner:owner});
  await assertCurrent(true);
  phase='build_independent_source';
  const result=await buildSavedChinaSource({inputDirectory,outputDirectory,head,archive,manifest,downloadCut,
    minimumYear:policy.minimumYear,assertCurrent,onProgress:value=>{
      // Builder progress is restricted to numeric aggregate counters.
      const counts=Object.fromEntries(Object.entries(value??{}).filter(([key,n])=>
        /^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(key)&&typeof n==='number'&&Number.isFinite(n)));
      progress({phase,...counts,published:false});
    }});
  await assertCurrent(true);
  assert.equal(rawDigest(await storage.readJson(downloadCutKey,null)),downloadCutSha256,'china_saved_download_changed');
  phase='save_private_source';
  const privateStorage=createPrivateChinaStorage({root:chinaSourceOutputRoot(owner)});
  await privateStorage.assertPrivateBucket();
  const durable=await savePrivateChinaSource({storage:privateStorage,owner,directory:outputDirectory,sourceManifest:result.manifest,
    assertCurrent,onProgress:progress});
  await privateStorage.assertPrivateBucket();
  await assertCurrent(true);
  const reconciliation=result.reconciliation;
  assert(reconciliation&&typeof reconciliation==='object','china_reconciliation_missing');
  // Only aggregate values are emitted. Vehicle records, identities, source URLs
  // and private archive pointers remain in the private source generation.
  report.reconciliation=Object.fromEntries(Object.entries(reconciliation).filter(([key,value])=>
    /^[a-zA-Z][a-zA-Z0-9]{0,59}$/.test(key)&&(typeof value==='number'&&Number.isFinite(value)||typeof value==='boolean')));
  assert(typeof reconciliation.sourceObservedAt==='string'&&Number.isFinite(Date.parse(reconciliation.sourceObservedAt)),
    'china_saved_observed_at');
  report.sourceObservedAt=reconciliation.sourceObservedAt;
  report.supplierLatestVerified=false;
  report.privateSourceReceiptSha256=durable.receiptSha256;
  report.privateSourceBytes=durable.totalBytes;
  report.completed=true;report.phase='saved_source_prepared';
  report.next='prepare_frozen_prices_and_search_indexes';
  report.finishedAt=new Date().toISOString();
  await fs.writeFile(output,JSON.stringify(report,null,2));
  progress(report);
}catch(error){
  report.phase=phase;report.errorCode=failCode(error);report.finishedAt=new Date().toISOString();
  await fs.writeFile(output,JSON.stringify(report,null,2));
  progress(report);process.exitCode=1;
}
