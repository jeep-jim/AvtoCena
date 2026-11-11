export function assertCancelledRepairOwner(lock, expectedOperationId, run, jobs) {
  if (!/^read-model-repair-[a-f0-9-]{36}$/.test(expectedOperationId || '') || lock?.operationId !== expectedOperationId || lock.operationType !== 'catalog_read_model_repair') throw Error('repair_lock_owner_mismatch');
  if (run?.status !== 'completed' || run.conclusion !== 'cancelled' || run.path !== '.github/workflows/catalog-current-read-models.yml' || run.repository?.full_name !== 'jeep-jim/AvtoCena') throw Error('repair_run_not_cancelled');
  if (!Array.isArray(jobs) || jobs.length !== 1 || jobs[0].name !== 'refresh' || jobs[0].run_id !== run.id || jobs[0].run_attempt !== run.run_attempt || jobs[0].status !== 'completed' || jobs[0].conclusion !== 'cancelled') throw Error('repair_job_not_cancelled');
  const step = jobs[0].steps?.find(step => step.name === 'Publish one-hop projections and offer shards');
  const started = Date.parse(lock.startedAt), stepStart = Date.parse(step?.started_at), stepEnd = Date.parse(step?.completed_at);
  if (step?.conclusion !== 'cancelled' || !Number.isFinite(started) || !Number.isFinite(stepStart) || !Number.isFinite(stepEnd) || started < stepStart || started > stepEnd) throw Error('repair_lock_not_owned_by_run');
  return {operationId:lock.operationId,startedAt:lock.startedAt,lockedUntil:lock.lockedUntil};
}

export async function releaseCancelledRepairLock({storage, mutate, expectedOperationId, run, jobs, now = () => new Date().toISOString()}) {
  const key = 'catalog/import-lock.json';
  const lock = await storage.readJson(key, null);
  const expected = assertCancelledRepairOwner(lock, expectedOperationId, run, jobs);
  await mutate(key, {}, current => {
    if (current.operationId !== expected.operationId || current.operationType !== 'catalog_read_model_repair' || current.startedAt !== expected.startedAt || current.lockedUntil !== expected.lockedUntil) throw Error('repair_lock_changed');
    return {...current,lockedUntil:'',finishedAt:now(),releaseReason:'confirmed_cancelled_workflow',cancelledRunId:run.id};
  });
  const after = await storage.readJson(key, null);
  if (after?.operationId !== expected.operationId || after.lockedUntil !== '') throw Error('repair_unlock_readback_changed');
  return {released:true,operationId:expected.operationId,cancelledRunId:run.id};
}
