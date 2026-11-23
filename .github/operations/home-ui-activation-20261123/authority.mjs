import {HOME_UI, sha256} from '../home-ui-only-20261123/contract.mjs';

const LOCK = 'catalog/import-lock.json', MANIFEST = 'catalog/manifest.json';
// Existing read-model repair bound:100min covers the entire90min release job.
const TTL = 100 * 60_000, HEARTBEAT = 5 * 60_000;
const need = (value, code) => { if (!value) throw Error('home_authority_' + code); };
const fingerprint = value => sha256(JSON.stringify({calculationVersion:HOME_UI.servingCalculationVersion,
  privateIndexDigest:HOME_UI.privateIndexDigest, manifest:value}));

async function homeAuthority({storage, nonce, readLiveIdentity, now = Date.now, heartbeat = true, resume}) {
  need(storage?.driver === 'object' && /^[a-f0-9]{32}$/.test(nonce || '') && typeof readLiveIdentity === 'function', 'context');
  const operationId = 'home-ui-catalog-0509-' + nonce;
  const read = () => storage.readJsonWithMeta(LOCK, {lockedUntil:''});
  const condition = meta => {
    need(!meta.found || typeof meta.etag === 'string' && meta.etag.length > 0, 'etag');
    return meta.found ? {ifMatch:meta.etag} : {ifNoneMatch:'*'};
  };
  const initial = await read(), until = initial.value?.lockedUntil;
  need(!until || Number.isFinite(Date.parse(until)), 'invalid_existing_lease');
  need(resume ? initial.found && initial.value?.operationId === operationId
    && initial.value.operationType === 'home_ui_only_release' && Date.parse(until) > now()
    : !until || Date.parse(until) <= now(), resume ? 'resume_owner' : 'publisher_busy');
  const lease = resume ? initial.value : {operationId, operationType:'home_ui_only_release', startedAt:new Date(now()).toISOString(),
    lockedUntil:new Date(now() + TTL).toISOString()};
  // No wait, force, foreign-owner override or broad mutation callback.
  try { if (!resume) await storage.writeJson(LOCK, lease, condition(initial)); }
  catch { throw Error('home_authority_acquire_conflict'); }
  let timer, failure, closed = false, pending = Promise.resolve(), expected = 'retained';
  const owned = meta => need(meta.found && meta.value?.operationId === operationId
    && Number.isFinite(Date.parse(meta.value.lockedUntil)) && Date.parse(meta.value.lockedUntil) > now(), 'lease_lost');
  const release = async () => {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    await pending.catch(() => {});
    const current = await read();
    if (current.value?.operationId !== operationId) throw Error('home_authority_foreign_release_refused');
    await storage.writeJson(LOCK, {...current.value, lockedUntil:'', finishedAt:new Date(now()).toISOString()}, condition(current));
    const after = await read();
    need(after.value?.operationId === operationId && after.value.lockedUntil === '', 'release_readback');
  };
  let manifest;
  try {
    owned(await read());
    manifest = await storage.readJsonWithMeta(MANIFEST, null);
    need(manifest.found && typeof manifest.etag === 'string' && manifest.etag.length > 0
      && manifest.value?.version === 2 && /^gen_\d+_[a-z0-9]+$/.test(manifest.value.generationId || ''), 'manifest');
    const live = await readLiveIdentity();
    need(live.release === HOME_UI.retainedSource && live.calculationVersion === HOME_UI.servingCalculationVersion, 'retained_runtime');
    if (resume) need(manifest.value.generationId === resume.generationId
      && fingerprint(manifest.value) === resume.acceptedReadModelFingerprint, 'resume_generation');
  } catch (error) { await release().catch(() => {}); throw error; }
  const generationId = manifest.value.generationId, acceptedReadModelFingerprint = fingerprint(manifest.value);
  const guard = async () => {
    need(!closed && !failure, 'heartbeat_failed');
    const [current, observed, live] = await Promise.all([read(), storage.readJsonWithMeta(MANIFEST, null), readLiveIdentity()]);
    owned(current);
    need(observed.found && observed.etag === manifest.etag && fingerprint(observed.value) === acceptedReadModelFingerprint,
      'accepted_generation_changed');
    need(live.release === (expected === 'candidate' ? HOME_UI.source : HOME_UI.retainedSource)
      && live.calculationVersion === HOME_UI.servingCalculationVersion, 'runtime_changed');
    return {operationId, generationId, acceptedReadModelFingerprint, lockedUntil:current.value.lockedUntil};
  };
  const renew = async () => {
    need(!closed, 'lease_closed');
    const current = await read(); owned(current);
    await storage.writeJson(LOCK, {...current.value, lockedUntil:new Date(now() + TTL).toISOString(),
      heartbeatAt:new Date(now()).toISOString()}, condition(current));
    owned(await read());
  };
  if (heartbeat) {
    timer = setInterval(() => { pending = pending.then(renew).catch(error => { failure = error; }); }, HEARTBEAT);
    timer.unref?.();
  }
  const stopHeartbeat = async () => { if (timer) clearInterval(timer); await pending.catch(() => {}); };
  return {lease:Object.freeze({...lease}), generationId, acceptedReadModelFingerprint, guard, renew, release, stopHeartbeat,
    setIngress(value) { need(['retained','candidate'].includes(value), 'ingress_state'); expected = value; }};
}

export const acquireHomeAuthority = options => homeAuthority(options);
// Only the same run's random owner and exact manifest may resume its bounded
// lease between plan-artifact upload and the waiting activation step.
export const resumeHomeAuthority = options => {
  need(options?.resume && /^gen_\d+_[a-z0-9]+$/.test(options.resume.generationId || '')
    && /^[a-f0-9]{64}$/.test(options.resume.acceptedReadModelFingerprint || ''), 'resume_context');
  return homeAuthority(options);
};
