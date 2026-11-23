import {execFileSync} from 'node:child_process';
import {HOME_UI, sha256} from '../home-ui-only-20261123/contract.mjs';

const key = 'catalog/import-lock.json';
const nonce = 'eac931f309e1102f85ea40af6be94f02';
const failed = 45200151578;
const observed = 45204233680;
const owner = 'home-ui-catalog-a059-' + nonce;
const need = (value, code) => { if (!value) throw Error('home_cleanup_' + code); };

async function exactRun(reader, id, path, sha, conclusion) {
  const run = await reader.json('/actions/runs/' + id);
  need(run.id === id && run.repository?.id === 1289722938 && run.head_repository?.id === 1289722938
    && run.head_branch === 'main' && run.path === '.github/workflows/' + path && run.head_sha === sha
    && run.run_attempt === 1 && run.status === 'completed' && run.conclusion === conclusion, 'run');
}

async function record(reader, artifactId, digest, name) {
  const raw = await reader.archive(artifactId);
  need(sha256(raw) === digest, 'artifact_digest');
  const script = "import io,json,sys,zipfile;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));i=z.getinfo(sys.argv[1]);assert i.file_size<=65536;print(json.dumps(json.loads(z.read(i))))";
  return JSON.parse(execFileSync('python3',['-I','-B','-c',script,name],{input:raw,encoding:'utf8',maxBuffer:131072}));
}

// Only the failed November 23 transaction can match. Its signed-in runner finished,
// and a later independent host read found its exact container gone and old ingress intact.
export async function finishAbandonedHomeRelease(storage, reader, readLiveIdentity, now = Date.now) {
  const {value, etag, found} = await storage.readJsonWithMeta(key, null);
  if (!found || value?.operationId !== owner || !value.lockedUntil || Date.parse(value.lockedUntil) <= now()) return false;
  need(storage.driver === 'object' && etag && value.operationType === 'home_ui_only_release'
    && value.startedAt === '2026-11-23T15:04:56.509Z' && value.heartbeatAt === '2026-11-23T15:10:15.577Z'
    && value.lockedUntil === '2026-11-23T16:50:15.577Z', 'lease_changed');
  await Promise.all([
    exactRun(reader,failed,'home-ui-activation.yml','14c71a4c50b82a4e3302cf27b2c863efa6f5f76a','failure'),
    exactRun(reader,observed,'catalog-serving-observation.yml','4bf664e7d2a082b4f7e5efbf7a98bf0f0b2e706b','success'),
  ]);
  const [outcome,scope,inventory,live,manifest] = await Promise.all([
    record(reader,14831973553,'d87dcbeec31146b4561ee842e54b0c08a53ffc120f681553b97ecfab6b1117f2','result.json'),
    record(reader,14833875060,'53d8a34433ba4309023e612052dc4cd07efff74916149d59d15bd9af9f550176','current-guest-scope.json'),
    record(reader,14833875060,'53d8a34433ba4309023e612052dc4cd07efff74916149d59d15bd9af9f550176','current-serving-inventory.json'),
    readLiveIdentity(),storage.readJson('catalog/manifest.json',null),
  ]);
  need(outcome.accepted === false && outcome.ingressState === 'retained' && outcome.nonce === nonce
    && outcome.planSha256 === '0fa175c89e4cbd4b488ab39d48c8d08572b82aea0ceda4c19451f88cfd093d62'
    && scope.readOnly === true && scope.dockerStatus === 404 && scope.candidateId === outcome.evidence?.candidate?.id
    && scope.retained === HOME_UI.retainedSource && inventory.nginxSha256 === 'b55e61e9686c639d9f0deac678b881ec56633e1cfd2b4703084b0ad9aaecaf6f'
    && inventory.containers.serving.release === scope.retained && inventory.candidatePort.socketListening === false
    && inventory.containers.serving.id === '52e44ba2810796f9a12ac83984d9571f71ac1290d852206d2a259ad44da02a8d'
    && live.release === scope.retained && live.calculationVersion === HOME_UI.servingCalculationVersion
    && manifest?.generationId === 'gen_1795428982165_8c56770d', 'retained_state');
  await storage.writeJson(key,{...value,lockedUntil:'',finishedAt:new Date(now()).toISOString(),
    releaseReason:'confirmed_retained_after_failed_45200151578'},{ifMatch:etag});
  const after = await storage.readJson(key,null);
  need(after?.operationId === owner && after.lockedUntil === '', 'readback');
  return true;
}
