import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {PAID_ENCAR_REPAIR_SNAPSHOT} from './lib/paid-encar-technical-repair.mjs';
import {loadPaidRepairPlan, createPaidRepairPublicationGuard, assertPaidRepairLeaseFree,
  installPaidRepairNetworkFence} from './lib/paid-encar-repair-io.mjs';
import {readLiveBudgetIdentity} from './lib/catalog-staged-budget.mjs';

export async function runPaidTechnicalRepair({action, output, producerFile}) {
  assert.ok(['plan','apply'].includes(action), 'paid_repair_action_invalid');
  const sourceSha = process.env.PAID_REPAIR_SOURCE_SHA, controllerSha = process.env.PAID_REPAIR_CONTROLLER_SHA;
  assert.match(sourceSha || '', /^[a-f0-9]{40}$/, 'paid_repair_source_unpinned');
  assert.match(controllerSha || '', /^[a-f0-9]{40}$/, 'paid_repair_controller_unpinned');
  assert.equal(controllerSha, process.env.GITHUB_SHA, 'paid_repair_controller_changed');
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(), sourceSha, 'paid_repair_source_changed');
  assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=normal'],{cwd:root,encoding:'utf8'}).trim(), '', 'paid_repair_source_dirty');
  const approved = process.env.PAID_REPAIR_APPROVED_SHA256;
  if (action === 'apply') assert.match(approved || '', /^[a-f0-9]{64}$/, 'paid_repair_approval_required');
  const expectedLive = {release:process.env.PAID_REPAIR_EXPECTED_RELEASE, calculationVersion:process.env.PAID_REPAIR_EXPECTED_CALCULATOR};
  assert.match(expectedLive.release || '', /^[a-f0-9]{40}$/, 'paid_repair_live_release_unpinned');
  assert.match(expectedLive.calculationVersion || '', /^[a-f0-9]{64}$/, 'paid_repair_live_calculator_unpinned');
  assert.equal(process.env.JSON_STORAGE_DRIVER, 'object', 'paid_repair_object_storage_required');
  installPaidRepairNetworkFence({endpoint:process.env.YC_OBJECT_STORAGE_ENDPOINT, bucket:process.env.YC_OBJECT_STORAGE_BUCKET,
    prefix:process.env.YC_OBJECT_STORAGE_PREFIX, allowWrites:action === 'apply'});
  const liveIdentity = await readLiveBudgetIdentity();
  assert.deepEqual(liveIdentity, expectedLive, 'paid_repair_live_runtime_changed');
  if (action === 'apply') {
    assert.equal(process.env.CATALOG_BUDGET_RUNTIME_RELEASE, liveIdentity.release, 'paid_repair_staged_runtime_unbound');
    assert.ok(process.env.CATALOG_BUDGET_RUNTIME_ROOT, 'paid_repair_staged_runtime_missing');
  }
  const [{getJsonStorage}, {EncarDirectAdapter}, {isEncarNonCashContract}, {normalizePaidEncarOffer},
    {paidEncarSavedPageVerifier}, {assertCollectionEnabled}, raw] = await Promise.all([
    import('../apps/web/lib/data.ts'), import('../apps/web/lib/catalog/adapters.ts'),
    import('../apps/web/lib/catalog/encar-sale-contract.ts'), import('./lib/paid-encar-offer.mjs'),
    import('./catalog-paid-encar-intake.mjs'), import('../apps/web/lib/catalog/collection-controls.ts'),
    import('./lib/catalog-raw-provenance.mjs'),
  ]);
  const storage = getJsonStorage();
  assert.equal(storage.driver, 'object', 'paid_repair_object_storage_required');
  await assertCollectionEnabled('encar_feed');
  assertPaidRepairLeaseFree(await storage.readJson('catalog/import-lock.json', null));
  // Plan is strictly read-only. Apply protects source roots before reading them
  // with the new actual workflow owner, never the legacy producer identity.
  let pin;
  if (action === 'apply') {
    const owner = raw.rawProducerOwner();
    pin = await raw.openRawFeedPin({storage, owner, operationId:`encar-technical-repair-${owner.runId}-${owner.attempt}`,
      references:[{kind:'encar-snapshot', root:`catalog/intake-staging/encar/${PAID_ENCAR_REPAIR_SNAPSHOT.runId}/${PAID_ENCAR_REPAIR_SNAPSHOT.attempt}`}]});
    await pin.add([]);
  }
  const adapter = new EncarDirectAdapter();
  const result = await loadPaidRepairPlan({storage, sourceSha, controllerSha, liveIdentity,
    producer:JSON.parse(await fs.readFile(producerFile,'utf8')), verifyPages:paidEncarSavedPageVerifier, isNonCash:isEncarNonCashContract,
    normalize:(data, context) => normalizePaidEncarOffer(data, {...context, adapter}),
    onSourceRoot:async reference => {if (pin) await pin.add([reference]);},
  });
  if (action === 'apply') assert.equal(result.receipt.sha256, approved, 'paid_repair_plan_changed');
  const guard = await createPaidRepairPublicationGuard({storage, receipt:result.receipt,
    expectedSha256:action === 'apply' ? approved : result.receipt.sha256});
  assertPaidRepairLeaseFree(await storage.readJson('catalog/import-lock.json', null));
  guard.assertInput(result.offers);
  const directory = path.resolve(output), inputs = path.join(directory,'input');
  assert.ok(!directory.startsWith(root + path.sep), 'paid_repair_output_must_be_outside_checkout');
  await fs.mkdir(inputs,{recursive:true});
  assert.equal((await fs.readdir(inputs)).length, 0, 'paid_repair_input_must_be_empty');
  const core = result.receipt.core;
  const report = {version:1, market:'korea', provider:'auto_api_encar', completed:true, completedAt:core.sourceProof.observedAt,
    mode:'saved_snapshot_technical_repair', snapshotRun:PAID_ENCAR_REPAIR_SNAPSHOT.runId,
    snapshotAttempt:PAID_ENCAR_REPAIR_SNAPSHOT.attempt, requiredSourceIds:['encar_direct'], confirmedWithdrawals:[],
    technicalRepair:result.receipt, rawStoragePins:pin ? [await pin.handoff()] : [],
    sources:[{sourceId:'encar_direct',provider:'auto_api_encar', uniqueOffers:result.offers.length,
      observations:0, freshSaved:0, mode:'technical_repair', syncMode:'technical_repair', stopReason:'source_finished',
      pages:core.sourceProof.pages, sourceSnapshotRows:core.sourceProof.rows}]};
  for (let offset = 0; offset < result.offers.length; offset += 500) {
    const rows = result.offers.slice(offset, offset + 500);
    await fs.writeFile(path.join(inputs,`catalog-rebuild-korea-${String(offset / 500 + 1).padStart(4,'0')}.json`),
      JSON.stringify({market:'korea', count:rows.length, offers:rows, ...(offset === 0 ? {report} : {})}));
  }
  await fs.writeFile(path.join(directory,'receipt.json'),JSON.stringify(result.receipt));
  const summary = {action, receiptSha256:result.receipt.sha256, sourceSha, controllerSha, liveIdentity,
    baseGenerationId:core.generationId, sourceIdentity:core.sourceProof.identity, observedAt:core.sourceProof.observedAt,
    currentRows:core.before.count, snapshotRows:core.sourceProof.rows, matched:core.sourceProof.matched,
    outcomes:core.outcomes, examples:core.examples, before:core.before, sourceCalls:0, cursorCommit:false, published:false};
  await fs.writeFile(path.join(directory,'summary.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify(summary));
  // Reuse the ordinary publisher, its quality/count/other-market guards, its
  // import lease and its exact serving-calculator barrier. No cursor commit.
  Object.assign(process.env, {CATALOG_REBUILD_MARKETS:'korea', CATALOG_REBUILD_INPUT_DIR:inputs,
    CATALOG_REBUILD_PUBLISH_REPORT:path.join(directory,'publication.json'),
    PAID_REPAIR_APPROVED_SHA256:result.receipt.sha256, CATALOG_SELLER_INVENTORY:'1', CATALOG_IMAGE_STORAGE_MODE:'source_urls_only',
    CATALOG_PUBLICATION_DRY_RUN:action === 'plan' ? '1' : '0', CATALOG_REBUILD_TARGET_PER_SOURCE:'0',
    CATALOG_PUBLISH_TARGET_PER_MARKET:'10000', CATALOG_PUBLISH_MAX_PER_MARKET:'0', CATALOG_REBUILD_MIN_IMAGES_PER_OFFER:'1',
    CATALOG_PUBLISH_PREPARE_CONCURRENCY:'4', CATALOG_READ_CONCURRENCY:'4', CATALOG_INDEX_WRITE_CONCURRENCY:'8',
    CATALOG_PUBLISH_LOCK_WAIT_MS:'0', CATALOG_PUBLISH_LOCK_TTL_MS:'1800000', CATALOG_PUBLISH_LOCK_HEARTBEAT_MS:'300000',
    CATALOG_CHUNKED_ALL_PROJECTION_WRITE:'1', YC_OBJECT_STORAGE_REQUEST_TIMEOUT_MS:'300000',
    CATALOG_ALLOW_PUBLIC_COLLAPSE:'0', CATALOG_REBALANCE_EXISTING:'0', CATALOG_APPEND_RETAINED_PUBLIC:'0'});
  await import('./catalog-publish-market.mjs');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPaidTechnicalRepair({action:process.argv[2], output:process.argv[3], producerFile:process.argv[4]})
    .catch(error => {console.error(String(error?.message || 'paid_repair_failed').replace(/https?:\/\/\S+/g,'[url]').slice(0,500)); process.exitCode = 1;});
}
