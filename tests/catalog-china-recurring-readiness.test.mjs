import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {inspectChinaRecurringReadiness} from '../scripts/catalog-china-recurring-readiness.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=x=>Buffer.from(JSON.stringify(x));
const plan=Buffer.from('{"version":1,"kind":"china-independent-daily-dry-v1","market":"china","controlSha256":"9e3f73d6282465019f43dcd0370bf9c71688445a0e361dccf641bd45acc5be62","revision":5,"target":{"runId":"full-fresh-44710087159-1","generationId":"gen_1795166586455_china44710087159","readySha256":"1080f0664095d3ed784eb1134cf20ab89c0facd33489b82f575eb7d279eb7cb6"},"archiveRoot":"catalog/nonjp-intake/v1/china/44457059256/1","archiveSha256":"b8a2a25dc27390845dd5a423efa323c9472a338b1b97f413ba96aefa7f3b65ca","snapshotConfigSha256":"25abfa4b8f1b053b12a1fcd86f01dc42de65eb8cb74f3863abf1a49115dfdb27","bootstrapReceiptSha256":"174893f63c5870628a3df1ab3a5241fe49847f01fa579a84d80a369383c3c49a"}\n');
assert.equal(sha(plan),'3b59460ceca450b10d5565fd31da6d1da10c993498a7419085327bb2594524d3');
const base=JSON.parse(plan);
const dryFixture={version:1,kind:'china-independent-daily-dry-evidence-v1',market:'china',
  generationId:base.target.generationId,revision:5,controlSha256:base.controlSha256,sourceRows:290044,
  nativeResume:{mode:'local_replica_and_changes',initialCursor:13123821,replicaSha256:'f'.repeat(64)},
  nextArchiveMustBeFresh:true,supplierRequests:0,storageWrites:0,publicationAuthorized:false,cursorAdvanceAuthorized:false,
  scheduleHeld:true,acceptedLegalUntil:Date.parse('2027-01-01T00:00:00Z'),currentStageDraftExpired:true};
const accepted={market:'china',receiptSha256:base.controlSha256,revision:5,
  coveredWakeAt:'2026-11-19T14:00:00.000Z',acceptedAt:'2026-11-20T11:19:00.000Z'};
const assemble=({ack:delta={},dry= dryFixture,now='2026-11-21T00:00:00.000Z',p=plan}={})=>{
  const pinnedDryEvidence=bytes(dry);
  const ack=bytes({version:1,kind:'china-recurring-baseline-ack-v1',market:'china',reviewOnly:true,
    publicationAuthorized:false,cursorAdvanceAuthorized:false,accepted,baseline:accepted,controlCursor:13123821,
    planSha256:sha(p),dryEvidenceSha256:sha(pinnedDryEvidence),held:false,ownerEnabled:true,
    scheduledWakeAt:'2026-11-20T14:00:00.000Z',claim:null,...delta});
  return {acknowledgement:ack,expectedAckSha256:sha(ack),acceptedPlan:p,pinnedDryEvidence,now};
};
test('exact approved rev5 plan binds current receipt, READY, archive and cursor for one lane',()=>{
  const r=inspectChinaRecurringReadiness(assemble());
  assert.equal(r.status,'china_one_lane_review_only');
  assert.equal(r.initialCursor,13123821);
  assert.equal(r.readySha256,base.target.readySha256);
  assert.equal(r.archiveSha256,base.archiveSha256);
  assert.equal(r.newCollectionAuthorized,false);
  assert.equal(r.publicationAuthorized,false);
  assert.equal(r.cursorAdvanceAuthorized,false);
  assert.equal(r.storageWrites,0);
  assert.equal(r.supplierRequests,0);
  assert.equal(r.scheduleChanged,false);
});
test('same slot survives both UTC+7 and UTC midnight, FX only frozen in later native prepare',()=>{
  const ats=['2026-11-20T16:59:59.999Z','2026-11-20T17:00:00.000Z','2026-11-20T23:59:59.999Z','2026-11-21T00:00:00.000Z'];
  const rs=ats.map(now=>inspectChinaRecurringReadiness(assemble({now})));
  for(const r of rs)assert.deepEqual(r,rs[0]);
  assert.deepEqual(rs[0].priceIntent,{phase:'after_verified_new_archive',policy:'freeze_once_per_prepare_run',
    sameReceiptThroughoutPrepareVerifyReadback:true,calendarRolloverRequiresNewReceipt:false,actualSourceAndTariffHorizonStillRequired:true});
});
test('draft expiration may not hide accepted legal horizon or enable stale incoming sources',()=>{
  assert.equal(inspectChinaRecurringReadiness(assemble()).status,'china_one_lane_review_only');
  const bad=assemble({dry:{...dryFixture,acceptedLegalUntil:Date.parse('2026-11-21T00:00:00.000Z')}});
  assert.throws(()=>inspectChinaRecurringReadiness(bad),/accepted_horizon/);
  assert.throws(()=>inspectChinaRecurringReadiness(assemble({dry:{...dryFixture,nextArchiveMustBeFresh:false}})),/dry_evidence_scope/);
});
test('held or unknown claim status remain held, no sibling override',()=>{
  assert.equal(inspectChinaRecurringReadiness(assemble({ack:{held:true}})).reason,'not_armed_or_owner_off');
  assert.equal(inspectChinaRecurringReadiness(assemble({ack:{claim:undefined}})).reason,'claim_status_not_verified');
  assert.throws(()=>inspectChinaRecurringReadiness(assemble({ack:{market:'korea'}})),/ack_scope/);
});
test('hash tamper and incompatible active/source evidence refuse',()=>{
  const i=assemble();
  for(const field of ['acknowledgement','acceptedPlan','pinnedDryEvidence'])
    assert.throws(()=>inspectChinaRecurringReadiness({...i,[field]:Buffer.concat([i[field],Buffer.from(' ')])}),/input_sha/);
  for(const dry of [
    {...dryFixture,revision:4},{...dryFixture,generationId:'gen_wrong'},
    {...dryFixture,nativeResume:{...dryFixture.nativeResume,initialCursor:13123822}},
    {...dryFixture,storageWrites:1},{...dryFixture,publicationAuthorized:true}
  ])assert.throws(()=>inspectChinaRecurringReadiness(assemble({dry})),/dry_evidence_scope/);
});

test('ordinary CLI can parse valid private files, redacts failed input, rejects symlink',async()=>{
  const {mkdtemp,readFile,writeFile,symlink,rm}=await import('node:fs/promises');
  const {spawnSync}=await import('node:child_process');
  const {tmpdir}=await import('node:os');
  const tmp=await mkdtemp(tmpdir()+'/china-recurring-command-');
  try{
    const now=Date.now();
    let wake=Math.floor(now/86400000)*86400000+14*3600000;
    if(wake>now) wake-=86400000;
    const old=new Date(wake-86400000).toISOString(),current=new Date(wake).toISOString();
    const evidence={...dryFixture,acceptedLegalUntil:now+86_400_000};
    const a={...accepted,acceptedAt:old,coveredWakeAt:old};
    const i=assemble({ack:{baseline:a,accepted:a,scheduledWakeAt:current},dry:evidence});
    const paths=['ack','plan','dry'].map(n=>tmp+'/'+n);
    for(const [n,b] of [i.acknowledgement,i.acceptedPlan,i.pinnedDryEvidence].entries())
      await writeFile(paths[n],b,{mode:0o600});
    const source=new URL('../scripts/catalog-china-recurring-readiness.mjs',import.meta.url);
    const invoke=(name)=>spawnSync(process.execPath,[decodeURIComponent(source.pathname),'--ack',tmp+'/'+name,
      '--expected-ack-sha',i.expectedAckSha256,'--accepted-plan',paths[1],'--dry-evidence',paths[2]],{encoding:'utf8'});
    const good=invoke('ack');
    assert.equal(good.status,0,good.stderr);
    assert.equal(JSON.parse(good.stdout).supplierRequests,0);
    assert.equal(JSON.parse(good.stdout).publicationAuthorized,false);
    await symlink(paths[0],tmp+'/link');
    const bad=invoke('link');
    assert.equal(bad.status,2,bad.stdout);
    assert.equal(JSON.parse(bad.stderr).reason,'local_review_input_unverified');
    assert.equal(await readFile(paths[0],'hex'),i.acknowledgement.toString('hex'));
  }finally{await rm(tmp,{recursive:true,force:true});}
});
