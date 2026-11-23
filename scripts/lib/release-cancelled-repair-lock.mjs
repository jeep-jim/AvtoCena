export function assertCancelledRepairOwner(lock, expectedOperationId, run, jobs, preflight) {
  if (!/^read-model-repair-[a-f0-9-]{36}$/.test(expectedOperationId || '') || lock?.operationId !== expectedOperationId || lock.operationType !== 'catalog_read_model_repair') throw Error('repair_lock_owner_mismatch');
  const budget=run?.path==='.github/workflows/backfill-budget-count-index.yml';
  if (run?.status !== 'completed' || run.conclusion !== 'cancelled' || (!budget && run.path !== '.github/workflows/catalog-current-read-models.yml') || run.repository?.full_name !== 'jeep-jim/AvtoCena') throw Error('repair_run_not_cancelled');
  if (!Array.isArray(jobs) || jobs.length !== 1 || jobs[0].name !== (budget?'prepare':'refresh') || jobs[0].run_id !== run.id || jobs[0].run_attempt !== run.run_attempt || jobs[0].status !== 'completed' || jobs[0].conclusion !== 'cancelled') throw Error('repair_job_not_cancelled');
  const stepName=budget?'Run node --import tsx scripts/backfill-budget-count-index.mjs':'Publish one-hop projections and offer shards';
  const step = jobs[0].steps?.find(step => step.name === stepName);
  const started = Date.parse(lock.startedAt), stepStart = Date.parse(step?.started_at), stepEnd = Date.parse(step?.completed_at);
  if (step?.conclusion !== 'cancelled' || !Number.isFinite(started) || !Number.isFinite(stepStart) || !Number.isFinite(stepEnd) || started < stepStart || started > stepEnd) throw Error('repair_lock_not_owned_by_run');
  if (budget) {
    // This preflight runs inside the lease. Its immutable artifact proves the
    // cancelled owner reached the protected section before the runner stopped.
    if (run.id!==45179611817 || run.run_attempt!==1 || jobs[0].id!==137709718742 ||
        run.head_branch!=='main' || run.head_sha!=='4409d7a51290ec64fef2816d7e01c8209a361e41' ||
        expectedOperationId!=='read-model-repair-bdaa91cb-4e4a-4c7f-9087-9bcdbb5b5121' ||
        lock.startedAt!=='2026-11-23T13:01:13.074Z' || lock.lockedUntil!=='2026-11-23T14:41:13.074Z' ||
        preflight?.ok!==true || preflight.checkedAt!=='2026-11-23T13:09:52.199Z' ||
        Date.parse(preflight.checkedAt)<started || Date.parse(preflight.checkedAt)>stepEnd) throw Error('budget_repair_owner_unverified');
  }
  return {operationId:lock.operationId,startedAt:lock.startedAt,lockedUntil:lock.lockedUntil};
}

export async function releaseCancelledRepairLock({storage, mutate, expectedOperationId, run, jobs, preflight, now = () => new Date().toISOString()}) {
  const key = 'catalog/import-lock.json';
  const lock = await storage.readJson(key, null);
  const expected = assertCancelledRepairOwner(lock, expectedOperationId, run, jobs, preflight);
  await mutate(key, {}, current => {
    if (current.operationId !== expected.operationId || current.operationType !== 'catalog_read_model_repair' || current.startedAt !== expected.startedAt || current.lockedUntil !== expected.lockedUntil) throw Error('repair_lock_changed');
    return {...current,lockedUntil:'',finishedAt:now(),releaseReason:'confirmed_cancelled_workflow',cancelledRunId:run.id};
  });
  const after = await storage.readJson(key, null);
  if (after?.operationId !== expected.operationId || after.lockedUntil !== '') throw Error('repair_unlock_readback_changed');
  return {released:true,operationId:expected.operationId,cancelledRunId:run.id};
}
