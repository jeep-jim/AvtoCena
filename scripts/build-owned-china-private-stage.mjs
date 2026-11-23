import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {chinaHeavyPolicyReason} from '../.github/operations/china-rev5-source-stage-v3/guard/work/budget-fallback/china-heavy-policy.mjs';
import {rawDigest} from './lib/catalog-raw-provenance.mjs';
import {ownedChinaPricedSource} from './lib/owned-china-frozen-pricing.mjs';

const [native,temp,planSha]=process.argv.slice(2);
const bytes=await fs.readFile(path.join(temp,'stage-input.json'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(bytes),planSha,'private stage input changed');
const input=JSON.parse(bytes);
const {plan,witness,sourceReport,fxWire,generationId,calculationVersion}=input;
const app=name=>import(pathToFileURL(path.join(native,name)).href);
const catalog=name=>app('apps/web/lib/catalog/'+name+'.ts');
const diskModule=await app('scripts/lib/china-shadow-disk.mjs');
const disk=await diskModule.openChinaShadowDisk(path.join(temp,'avtocena-china-shadow-owned'),true);
process.chdir(path.join(temp,'avtocena-china-context-owned'));
Object.assign(process.env,disk.env,{AVTOCENA_CALCULATION_VERSION:calculationVersion});
globalThis.fetch=disk.fetchMock;
const [rates,pricing,replay,publicationModule,heavy,identity,{ObjectJsonStorage}]=await Promise.all([
  catalog('rates'),catalog('shared-budget-prices'),catalog('prepared-china-fresh-price-replay'),
  catalog('independent-market-activation-fixture'),catalog('heavy-vehicle-families'),catalog('public-identity-policy'),app('apps/web/lib/data.ts'),
]);
const frozen=rates.importCatalogFxBatch(fxWire,fxWire.receiptSha256);
const fingerprint=await rates.withCatalogFxBatch(frozen,()=>pricing.budgetPricingFingerprint('china'));
assert.equal(pricing.calculationCacheVersion(),calculationVersion,'pricing context changed');
const pricedSource=ownedChinaPricedSource(plan.source,frozen.receipt);
const fence=async()=>assert(Date.now()<pricedSource.validUntil,'saved price or source expired');
const binding={continuitySha256:rawDigest({source:plan.source,witness,control:plan.control}),sourceReportSha256:plan.evidence.archive.reportSha256,
  nativeAdmissionSha256:rawDigest({conversion:plan.conversion,shards:plan.converted,inventory:witness.normalized}),
  sourceReplicaSha256:plan.source.cursor.anchorSha256,sourceCursor:plan.source.cursor.sequence,
  sourceExpiresAt:pricedSource.validUntil,sourceBinding:sourceReport.binding};
const spool=path.join(temp,'avtocena-china-fresh-prices-owned');
const priceJob=await replay.openFreshChinaPriceReplay({directory:spool,fx:frozen,pricingFingerprint:fingerprint,
  calculationVersion,expectedInputRows:plan.sourceArchiveRows,source:binding,assertSourceAuthority:fence});
const order=createHash('sha256').update('prepared-ordered-admitted-ids-v1\n');
const observations=createHash('sha256').update('china-full-fresh-source-ordered-input-v1\n');
const withdrawn=new Map(sourceReport.withdrawals.map(row=>[row.id,row]));
const picksDir=path.join(temp,'selection');await fs.mkdir(picksDir,{mode:0o700});
const parts=[];let admitted=0,excluded=0,explicit=0,eligible=0,unsupported=0;
try {
  for(const entry of plan.converted){
    await fence();
    assert(/^catalog-rebuild-china-\d{4,}\.json$/.test(entry.name),'source shard path');
    const filename=path.join(temp,'converted',entry.name);
    const body=await fs.readFile(filename);
    assert.equal(body.length,entry.bytes);assert.equal(sha(body),entry.sha256);
    const rows=JSON.parse(body).offers;assert.equal(rows.length,entry.rows);
    const dispositions=rows.map(row=>{
      const terminal=row.operational?.che168ActiveVerification;
      assert(row.sourceId==='autohome_used_china_open' && row.market==='china' && row.status==='active' &&
        row.id===sha(row.sourceId+':'+row.sourceOfferId).slice(0,24) && terminal?.snapshotBinding===binding.sourceBinding &&
        terminal.cursor===binding.sourceCursor && terminal.verifiedAt===sourceReport.completedAt,'unbound source row');
      const id=row.id,inputSha256=rawDigest(row);
      observations.update(JSON.stringify({id,inputSha256})+'\n');
      const event=withdrawn.get(id);
      if(event && event.sourceOfferId===row.sourceOfferId && Date.parse(event.observedAt)>=Date.parse(terminal.verifiedAt)){
        explicit++;return {id,inputSha256,state:'withdrawn',reason:event.status};
      }
      const reason=chinaHeavyPolicyReason(row,{knownHeavyFamily:heavy.knownHeavyVehicleFamily});
      if(reason){excluded++;return {id,inputSha256,state:'excluded',reason};}
      eligible++;return {id,inputSha256,state:'eligible_unpriced'};
    });
    const priced=await priceJob.consume({rows,dispositions});
    const picks=[];
    for(const [j,result] of priced.entries()){
      if(result.state!=='admitted')continue;
      if(!identity.isSupportedPublicCatalogIdentity(rows[j])){unsupported++;continue;}
      order.update(JSON.stringify(result.id)+'\n');admitted++;
      picks.push({id:result.id,canonicalSha256:result.canonicalSha256});
    }
    const selected=Buffer.from(JSON.stringify(picks)),file=path.join(picksDir,String(parts.length)+'.json');
    await fs.writeFile(file,selected,{flag:'wx',mode:0o600});parts.push({file,sha256:sha(selected)});
    // This runner's hash-verified temporary conversion can now be replayed from its SQLite spool.
    await fs.unlink(filename);
    if(parts.length%25===0)console.log(JSON.stringify({stage:'price_saved_china',shards:parts.length,admitted}));
  }
  const proof={version:1,kind:'china-full-fresh-source-admission-only',coverage:'materialized_complete_replica_after_committed_delta',
    oldRowsMerged:false,priced:false,publicationAuthorized:false,cursorAdvanceAuthorized:false,...binding,
    sourceRows:plan.sourceArchiveRows,eligibleUnpricedRows:eligible,excludedRows:excluded,explicitlyWithdrawnRows:explicit,
    orderedInputSha256:observations.digest('hex')};
  const {counts}=await priceJob.seal({proof,proofSha256:rawDigest(proof)});
  assert.equal(counts.admitted,admitted+unsupported);
  const selection={admittedRows:admitted,orderedAdmittedIdsSha256:order.digest('hex'),assertCurrent:fence,async *picks(){
    for(const part of parts){const b=await fs.readFile(part.file);assert.equal(sha(b),part.sha256);yield* JSON.parse(b);}
  }};
  const storage=new ObjectJsonStorage();
  const backend={kind:'mock-s3',origin:disk.endpoint,bucket:disk.bucket,prefix:disk.prefix,fixtureFetch:disk.fetchMock};
  const publication=publicationModule.openIndependentMarketFixture(storage,'china',{...backend,assertAuthorized:fence});
  const base=await publication.observe();
  const lease=await publication.acquire({action:'publish',generationId,expectedBaseSha256:base.baseSha256},Math.min(8*3600000,pricedSource.validUntil-Date.now()));
  const staged=await priceJob.stageCanonical({publication,lease,source:pricedSource,withdrawn:[],blockRows:50,modelScope:{make:'BMW',model:'X3'},
    withStreamingSearch:true,freshSnapshot:true,selection,backend});
  const ready=await diskModule.finalizeChinaShadowStage({disk,storage,publication,lease,staged,archiveSha256:plan.evidence.archive.manifestSha256,
    source:pricedSource,fxReceiptSha256:frozen.receiptSha256,count:admitted,streaming:true});
  const summary={ready,counts,unsupported,selected:admitted,orderedAdmittedIdsSha256:selection.orderedAdmittedIdsSha256,
    sourceProofSha256:rawDigest(proof),fxReceiptSha256:frozen.receiptSha256,pricingFingerprint:fingerprint};
  await fs.writeFile(path.join(temp,'private-result.json'),JSON.stringify(summary),{flag:'wx',mode:0o600});
} finally {priceJob.close();}
await fs.unlink(path.join(spool,'priced.sqlite'));
