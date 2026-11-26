import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createChinaState} from '../scripts/catalog-next/china-state.mjs';
import {REPORT, localDefinition, verifyInvocation, leaseOnlyStorage, verifyState, copyReply, runRetirement}
  from '../scripts/catalog-next/retire-obsolete-deployments-20261127.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const plan = localDefinition(ROOT), clone = value => structuredClone(value);
const sha = value => createHash('sha256').update(value).digest('hex');
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const bytes = value => Buffer.from(JSON.stringify(ordered(value)));
const absent = () => ({found: false, etag: null, sha256: null, value: null});
const PRIVATE = 'private-synthetic-token-never-echo';
const current = '077cbb17626ab0c64e7f06db055fef9252ad21c0', rollback = '36c7ea726e7f070d10dbc65afc6538f13c0c1a24';

async function fixture(t, mode = 'success') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'obsolete-retire-')); t.after(() => fs.rm(root, {recursive: true, force: true}));
  const values = new Map(), writes = [], calls = [], logs = []; let sequence = 0, setup = true;
  const storage = {assertPrivateBucket: async () => ({verified: true}),
    read: async name => clone(values.get(name) ?? absent()),
    async compareAndSwap(name, previous, value) {
      if (!setup) assert.equal(name, 'lease');
      assert.equal(previous.etag, (values.get(name) ?? absent()).etag); writes.push(name);
      values.set(name, {found: true, etag: '"' + PRIVATE + ++sequence + '"', sha256: sha(bytes(value)), value: clone(value)});
    }};
  const state = createChinaState({storage});
  const owner = {runId: '45655051136', attempt: '1', revision: 'a'.repeat(40)};
  const base = {market: 'china', generationId: 'gen_china_45655051136_1', owner, receiptSha256: '1'.repeat(64),
    sourceDescriptorSha256: '2'.repeat(64), generationManifestSha256: '3'.repeat(64), sourceCursor: 1,
    sourceObservedAt: '2026-11-25T17:34:57.542Z', pricingRuntimeSha: '4'.repeat(40)};
  for (const [index, runtimeSha] of [rollback, current].entries()) {
    const nonce = String(index + 5).repeat(32), candidate = {...base, runtimeSha, imageId: 'sha256:' + String(index + 6).repeat(64)};
    const lease = await state.acquireLease({previous: await state.read('lease'), owner, nonce, expiresAt: new Date(Date.now() + 3600000).toISOString()});
    const staged = await state.reserve({lease, previous: await state.read('accepted'), previousIntent: await state.read('intent'),
      candidate, ...(index ? {transition: 'code-update'} : {})});
    const speed = Buffer.from(JSON.stringify({release: runtimeSha, passed: true, browserPassed: true, speedGuard: {passed: true}}));
    const details = Buffer.from(JSON.stringify({kind: 'china-browser-details-v1', release: runtimeSha, nonce, passed: true,
      generationManifestSha256: candidate.generationManifestSha256, precedingSpeedReportSha256: sha(speed)}));
    const receipt = {version: 1, kind: 'china-host-acceptance-v1', nonce, release: runtimeSha, imageId: candidate.imageId,
      pricingRuntimeSha: candidate.pricingRuntimeSha, generationId: candidate.generationId, generationManifestSha256: candidate.generationManifestSha256,
      privateGenerationReceiptSha256: candidate.receiptSha256, sourceDescriptorSha256: candidate.sourceDescriptorSha256,
      sourceCursor: candidate.sourceCursor, sourceObservedAt: candidate.sourceObservedAt, acceptedAt: new Date().toISOString(),
      retainedContainerId: '7'.repeat(64), browser: {release: runtimeSha, nonce, passed: true, functionalPassed: true, speedPassed: true,
        speedReportSha256: sha(speed), detailsReportSha256: sha(details), reportSha256: sha(Buffer.concat([speed, details]))}, private: PRIVATE};
    if (index) Object.assign(receipt, {transition: 'code-update', previousAcceptedETag: staged.intent.value.previous.etag,
      previousAcceptedStateSha256: staged.intent.value.previous.sha256, retainedRuntimeSha: rollback,
      retainedImageId: staged.intent.value.previous.value.current.imageId});
    const raw = Buffer.from(JSON.stringify(receipt));
    await state.commit({lease, ...staged, evidence: {hostReceiptBase64: raw.toString('base64'), hostReceiptSha256: sha(raw),
      browserSpeedBytes: speed, browserDetailsBytes: details}}); await state.releaseLease({lease});
  }
  const expected = {accepted: await state.read('accepted'), intent: await state.read('intent')};
  setup = false; writes.length = 0;
  const local = clone(plan);
  for (const name of ['accepted', 'intent']) Object.assign(local.definition.capture,
    {[name + 'Sha256']: expected[name].sha256, [name + 'ETagSha256']: sha(expected[name].etag)});
  for (const name of ['current', 'rollback']) local.definition.referenceSha256[name] = sha(bytes(expected.accepted.value[name]));
  local.definitionSha256 = sha(bytes(local.definition));
  let free = 100000, prepared;
  const steps = [];
  const session = {async bootstrap(authority) {
    calls.push('prepare'); assert.equal(authority.lease.value.status, 'held');
    prepared = {kind: 'obsolete-deployments-retirement-prepared-v1', captureReportSha256: local.definition.capture.reportSha256,
      definitionSha256: local.definitionSha256, targets: local.definition.targets, alreadyAbsentContainers: mode === 'idempotent' ? 2 : 0,
      imagesPreserved: 7, diskAvailableBytes: free}; return prepared;
  }, async call(message) {
    calls.push(message.action === 'retire' ? message.index : 'finish'); assert.equal(message.authority.lease.value.status, 'held');
    if (message.action === 'retire') {
      if ((mode === 'unknown' && message.index === 0) || (mode === 'partial' && message.index === 1)) throw Error(PRIVATE);
      if (mode === 'refused') return {kind: 'obsolete-deployments-retirement-refused-v1', errorCode: PRIVATE, uncertain: false};
      const target = local.definition.targets[message.index], before = free, noop = mode === 'idempotent'; free += noop ? 0 : 4096;
      const value = {kind: 'obsolete-deployment-retired-v1', index: message.index, name: target.name, containerId: target.containerId,
        retiredContainers: noop ? 0 : 1, filesDeleted: noop ? 0 : target.files, verifiedContentBytesDeleted: noop ? 0 : target.bytes,
        diskAvailableBytesBefore: before, diskAvailableBytesAfter: free, measuredFreeBytesChange: free - before,
        allTargetBulkAbsent: true, proofsPreserved: true, imagesDeleted: 0, directoriesDeleted: 0};
      steps.push(value);
      if (mode === 'changed' && message.index === 0) {
        const value = clone(values.get('accepted')); value.value.revision++; value.sha256 = sha(bytes(value.value)); values.set('accepted', value);
      }
      return value;
    }
    return {kind: 'obsolete-deployments-retirement-result-v1', completed: true, captureReportSha256: local.definition.capture.reportSha256,
      definitionSha256: local.definitionSha256, currentRuntimeSha: current, rollbackRuntimeSha: rollback,
      retiredContainers: steps.reduce((n, row) => n + row.retiredContainers, 0), alreadyAbsentContainers: prepared.alreadyAbsentContainers,
      filesDeleted: steps.reduce((n, row) => n + row.filesDeleted, 0), verifiedContentBytesDeleted: steps.reduce((n, row) => n + row.verifiedContentBytesDeleted, 0),
      diskAvailableBytesBefore: prepared.diskAvailableBytes, diskAvailableBytesAfter: free, measuredFreeBytesChange: free - prepared.diskAvailableBytes,
      remainingContainers: 4, imagesPreserved: 7, imagesDeleted: 0, directoriesDeleted: 0, proofsPreserved: true, manifestsPreserved: true,
      ingressUnchanged: true, acceptedStateWrites: 0, intentStateWrites: 0, generationStorageWrites: 0, supplierRequests: 0};
  }, async finish() { calls.push('exit'); }, async close() { calls.push('close'); }};
  const args = {root, environment: {GITHUB_RUN_ID: '999999', GITHUB_RUN_ATTEMPT: '1'}, log: row => logs.push(row), capabilities: {
    verifyInvocation: () => ({sourceSha: 'a'.repeat(40), approvedSourceSha: 'b'.repeat(40)}), verifyBaselines() {},
    localDefinition: () => local, createStorage: () => storage, openSession: async () => session}};
  return {root, values, writes, calls, logs, args, local, expected, session};
}

test('immutable selector is bound to executed read-only capture and precisely two deployments / thirteen files', () => {
  assert.equal(plan.definition.capture.reportSha256, 'ca7297d4ca9e792b1ef85b14a2d530a4d2eb18657dddbff585bced820e36f32c');
  assert.equal(plan.definition.capture.definitionSha256, '623a6e89ff1e89368f8572b95306aa00abf62a3ad1224f5a27cadb863af26eed');
  assert.deepEqual(plan.definition.targets.map(row => row.files), [7, 6]);
  assert.equal(plan.definition.targets.reduce((sum, row) => sum + row.bytes, 0), 25649982642);
  assert.equal(sha(bytes(plan.definition)), plan.definitionSha256);
});

for (const mode of ['success', 'idempotent']) test('native lease-only controller finishes exact ' + mode + ' without accepted/intent/source writes', async t => {
  const f = await fixture(t, mode), report = await runRetirement(f.args);
  assert.equal(report.completed, true); assert.equal(report.leaseRelease, 'released'); assert.equal(report.status, 'retired');
  assert.deepEqual(f.calls, ['prepare', 0, 1, 'finish', 'exit', 'close']); assert.deepEqual(f.writes, ['lease', 'lease']);
  assert.equal(report.result.retiredContainers, mode === 'success' ? 2 : 0);
  assert.deepEqual(f.values.get('accepted'), f.expected.accepted); assert.deepEqual(f.values.get('intent'), f.expected.intent);
  const raw = await fs.readFile(path.join(f.root, REPORT), 'utf8');
  assert.doesNotMatch(raw, new RegExp(PRIVATE)); assert.doesNotMatch(raw, /Base64|"etag"|"nonce"|publicationState/);
});

for (const mode of ['unknown', 'partial', 'refused', 'changed']) test('stops after ' + mode + ' and never advances an uncertain target', async t => {
  const f = await fixture(t, mode); await assert.rejects(runRetirement(f.args));
  const raw = await fs.readFile(path.join(f.root, REPORT), 'utf8'), report = JSON.parse(raw);
  assert.doesNotMatch(raw, new RegExp(PRIVATE)); assert.equal(report.completed, false); assert(!f.calls.includes('finish'));
  if (['unknown', 'partial'].includes(mode)) {
    assert.equal(report.status, 'needs_reconciliation'); assert.equal(report.leaseRelease, 'expires');
    assert.deepEqual(f.writes, ['lease']); assert.equal(f.values.get('lease').value.status, 'held');
  } else { assert.equal(report.leaseRelease, 'released'); assert.deepEqual(f.writes, ['lease', 'lease']); }
  assert.equal(report.steps.length, ['partial', 'changed'].includes(mode) ? 1 : 0);
  if (mode !== 'partial') assert(!f.calls.includes(1));
});

test('lease-only storage rejects accepted/intent CAS before any request', async () => {
  const storage = leaseOnlyStorage({environment: {JSON_STORAGE_DRIVER: 'object', YC_OBJECT_STORAGE_ENDPOINT: 'https://s3.regru.cloud',
    YC_OBJECT_STORAGE_REGION: 'us-east-1', YC_OBJECT_STORAGE_BUCKET: 'avtocena-staging-8120751',
    YC_OBJECT_STORAGE_PREFIX: 'migration-staging/full-20261011/', YC_OBJECT_STORAGE_ACCESS_KEY_ID: 'synthetic', YC_OBJECT_STORAGE_SECRET_ACCESS_KEY: PRIVATE},
    fetcher: () => assert.fail('unexpected transport')});
  assert.throws(() => storage.compareAndSwap('accepted', {}, {}), /storage_scope/);
  assert.throws(() => storage.compareAndSwap('intent', {}, {}), /storage_scope/);
  assert.deepEqual(Object.keys(storage).sort(), ['assertPrivateBucket','compareAndSwap','read']);
});

test('a changed authority or foreign marker workflow is refused before operations', async t => {
  const f = await fixture(t), bad = clone(f.expected); bad.accepted.etag = '"changed"';
  assert.throws(() => verifyState(bad, f.local.definition));
  for (const environment of [{GITHUB_EVENT_NAME: 'workflow_dispatch'}, {GITHUB_EVENT_NAME: 'push', GITHUB_WORKFLOW_REF: 'foreign', GITHUB_JOB: 'retire'}])
    assert.throws(() => verifyInvocation({root: ROOT, environment}));
});

test('private or inconsistent replies cannot become a success report', () => {
  const prepared = {kind: 'obsolete-deployments-retirement-prepared-v1', captureReportSha256: plan.definition.capture.reportSha256,
    definitionSha256: plan.definitionSha256, targets: plan.definition.targets, alreadyAbsentContainers: 0, imagesPreserved: 7, diskAvailableBytes: 100};
  assert.deepEqual(copyReply(prepared, 'prepare', plan), prepared);
  for (const value of [{...prepared, private: PRIVATE}, {...prepared, definitionSha256: '0'.repeat(64)},
    {...prepared, imagesPreserved: Infinity}, {...prepared, targets: [...prepared.targets, prepared.targets[0]]}])
    assert.throws(() => copyReply(value, 'prepare', plan), /preparation/);
  assert.throws(() => copyReply({kind: 'obsolete-deployments-retirement-refused-v1', errorCode: PRIVATE, uncertain: true}, 'prepare', plan),
    error => error.message === 'obsolete_retirement_remote_unknown' && error.uncertain === true);
});

test('host uses held authority, actual content hashes, exact deletion and restart-safe partial handling', () => {
  const python = String.raw`
import copy, datetime, importlib.util, json, os, pathlib, stat, tempfile
def load(name,file):
  spec=importlib.util.spec_from_file_location(name,file); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module
original_m=load('retire','scripts/catalog-next/retire-obsolete-deployments-20261127.py')
for fault in [None,'running','state','lease','hash','partial','shared','extra','proof','dangling']:
  m=load('retire','scripts/catalog-next/retire-obsolete-deployments-20261127.py')
  c=load('capture','scripts/catalog-next/inspect-obsolete-deployments-20261127.py')
  h=load('host','scripts/catalog-next/release-host.py')
  with tempfile.TemporaryDirectory() as temporary:
    root=pathlib.Path(temporary); root.chmod(0o700); h.BASE=root/'releases'; h.BASE.mkdir(mode=0o700)
    h.CONFIG=root/'nginx'; h.CONFIG.write_bytes(b'proxy_pass http://127.0.0.1:3007;')
    lock=root/'lock'; lock.write_bytes(b''); h.reuse_lock=lambda:os.open(lock,os.O_RDONLY)
    h.private_directory=lambda value:None
    def regular(filename,maximum=None):
      metadata=filename.lstat(); assert filename.resolve().is_relative_to(root)
      h.need(stat.S_ISREG(metadata.st_mode) and metadata.st_nlink==1 and not filename.is_symlink(),'regular_file')
      if maximum is not None: h.need(metadata.st_size<=maximum,'file_size')
      return metadata
    h.regular=regular; h.subprocess.run=lambda *a,**k:(_ for _ in ()).throw(AssertionError('subprocess forbidden'))
    refs={}; receipts={}; dirs={}; plans={}; by_id={}; operations=[]
    for index,(name,pin) in enumerate(c.HISTORY.items()):
      nonce=str(index+1)*32; directory=h.BASE/pin['runtimeSha']/'china-next'/nonce; (directory/'generation').mkdir(parents=True)
      generation={'generationId':pin['generationId'],'runtimeSha':'5'*40,'prepared':True,'source':{'cursor':1,'sourceObservedAt':'2026-11-25T00:00:00Z'}}
      raw=json.dumps(generation).encode(); (directory/'generation'/'GENERATION.json').write_bytes(raw); pin['manifestSha256']=m.sha(raw)
      receipt={'nonce':nonce}; raw=json.dumps(receipt).encode(); (directory/'ACCEPTED.json').write_bytes(raw); pin['acceptedSha256']=m.sha(raw)
      pin['attemptHash']=m.sha(nonce.encode())[:16]
      refs[name]={'market':'china','runtimeSha':pin['runtimeSha'],'imageId':pin['imageId'],'generationId':pin['generationId'],
        'generationManifestSha256':pin['manifestSha256'],'pricingRuntimeSha':'5'*40,'sourceCursor':1,'sourceObservedAt':'2026-11-25T00:00:00Z',
        'proof':{'hostReceiptSha256':pin['acceptedSha256']}}
      descriptors=[]
      for filename in ['details.sqlite','query.sqlite']:
        content=(name+filename).encode(); (directory/'generation'/filename).write_bytes(content)
        descriptors.append({'name':filename,'bytes':len(content),'sha256':m.sha(content),'compressedBytes':1,'compressedSha256':'c'*64})
      dirs[name],receipts[name],plans[name]=directory,receipt,{'files':descriptors}
    for parent,current,rollback in [('current','rollback','obsoleteB'),('rollback','obsoleteB','obsoleteA')]:
      prior={'current':refs[current],'rollback':refs[rollback]}
      plans[parent].update(previousAcceptedState=prior,previousAcceptedETag='"old"',previousAcceptedStateSha256=h.canonical_sha(prior))
    for name,pin in c.HISTORY.items():
      raw=json.dumps(plans[name]).encode(); (dirs[name]/'PLAN.json').write_bytes(raw); pin['planSha256']=m.sha(raw)
      m.REFERENCE_HASHES[name]=h.canonical_sha(refs[name])
    for identifier,running,_ in c.CONTAINERS:
      name=next((name for name,pin in c.HISTORY.items() if pin['containerId']==identifier),None)
      row={'Id':identifier,'Image':c.HISTORY[name]['imageId'] if name else 'sha256:'+'f'*64,'Config':{'Env':[],'Labels':{}},
           'HostConfig':{},'Mounts':[],'RestartCount':0,'State':{'Running':running,'Pid':1 if running else 0,'StartedAt':'2026-11-25T00:00:00Z'}}
      if name:
        ref=refs[name]; nonce=receipts[name]['nonce']; row['Config']={'Labels':{'avtocena.china.nonce':nonce,'avtocena.application':'web','avtocena.role':'independent-china'},
          'Env':['AVTOCENA_RELEASE_SHA='+ref['runtimeSha'],'AVTOCENA_CALCULATION_VERSION='+h.CALCULATION,'CATALOG_CHINA_LOCAL_RUNTIME_SHA='+ref['pricingRuntimeSha'],
          'CATALOG_CHINA_LOCAL_MANIFEST_SHA256='+ref['generationManifestSha256'],'CATALOG_CHINA_LOCAL_GENERATION_DIR='+h.GENERATION_MOUNT]}
        row['Mounts']=[{'Source':str(dirs[name]/'generation'),'Destination':h.GENERATION_MOUNT,'Type':'bind','RW':False}]
      by_id[identifier]=row
    c.CONTAINERS=[(identifier,row['State']['Running'],c.configuration_sha(row)) for identifier,row in by_id.items()]
    m.CAPTURE['definitionSha256']=m.sha(m.canonical(c.definition())); m.CAPTURE['ingressSha256']=m.sha(h.CONFIG.read_bytes())
    for target in m.TARGETS:
      rows=[{k:r[k] for k in ['name','bytes','sha256']} for r in plans[target['name']]['files']]
      target.update(files=len(rows),bytes=sum(r['bytes'] for r in rows),descriptorsSha256=m.sha(m.canonical(rows)))
    def observation(value): return {'found':True,'etag':'"fixed"','sha256':h.canonical_sha(value),'value':value}
    state={'current':refs['current'],'rollback':refs['rollback']}; view={'accepted':observation(state),'intent':observation({'status':'aborted'})}
    for name in ['accepted','intent']:
      m.CAPTURE[name+'Sha256']=view[name]['sha256']; m.CAPTURE[name+'ETagSha256']=m.sha(view[name]['etag'].encode())
    lease={'kind':'china-market-lease-v1','market':'china','status':'held','releasedAt':None,'nonce':'a'*32,
      'owner':{'runId':'999','attempt':'1','revision':'a'*40},'expiresAt':(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=10)).isoformat()}
    authority={'publicationState':view,'lease':observation(lease)}
    h.checked_publication_view=lambda value:(h.checked_observation(value['accepted']),h.checked_observation(value['intent']))
    h.checked_accepted_observation=lambda value:h.checked_observation(value)
    def name_of(reference): return next(name for name,value in refs.items() if value==reference)
    h.verified_history=lambda reference:receipts[name_of(reference)]
    h.accepted_reference_receipt=lambda reference:(receipts[name_of(reference)],json.dumps(receipts[name_of(reference)]).encode())
    h.reference_plan=lambda reference,receipt:(dirs[name_of(reference)],plans[name_of(reference)])
    images=[{'Id':'sha256:'+str(i)*64} for i in range(1,8)]
    def docker(method,route,body=None):
      operations.append((method,route)); assert body is None
      if method=='GET' and route=='/images/json?all=1': return copy.deepcopy(images)
      if method=='GET' and route=='/containers/json?all=1': return [{'Id':identifier} for identifier in by_id]
      identifier=route.split('/')[2].split('?')[0]
      if method=='GET': return copy.deepcopy(by_id[identifier])
      assert method=='DELETE' and identifier in {r['containerId'] for r in m.TARGETS} and route.endswith('?v=false&force=false')
      del by_id[identifier]; return None
    h.docker=docker
    h.response_json=lambda port,route,timeout=5:{'ok':True,'releaseSha':c.CURRENT if port==3007 else c.ROLLBACK,'calculationVersion':h.CALCULATION}
    if fault=='dangling':
      native_retire=h.retire_reference
      def retire_with_late_link(*args):
        result=native_retire(*args)
        (dirs['obsoleteA']/'generation'/'details.sqlite').symlink_to(root/'missing-target')
        return result
      h.retire_reference=retire_with_late_link
    if fault=='state': authority['publicationState']['accepted']['etag']='"changed"'
    if fault=='lease': authority['lease']['value']['status']='released'; authority['lease']['sha256']=h.canonical_sha(authority['lease']['value'])
    if fault=='running': by_id[m.TARGETS[0]['containerId']]['State']['Running']=True
    if fault=='extra': by_id['e'*64]=copy.deepcopy(next(iter(by_id.values()))); by_id['e'*64]['Id']='e'*64
    target_path=dirs['obsoleteA']/'generation'/'query.sqlite'
    if fault in ['hash','partial']: target_path.write_bytes(b'X'*target_path.stat().st_size)
    if fault=='shared': by_id[c.HISTORY['current']['containerId']]['Mounts'].append({'Source':str(dirs['obsoleteA']),'Destination':'/foreign','Type':'bind','RW':False})
    if fault=='proof': (dirs['obsoleteA']/'PLAN.json').write_bytes(b'{}')
    retirement=None
    try:
      retirement=m.Retirement(h,c,authority)
      assert retirement.prepared()['alreadyAbsentContainers']==0
      first=retirement.step({'action':'retire','index':0,'authority':authority})
      second=retirement.step({'action':'retire','index':1,'authority':authority})
      result=retirement.finish({'action':'finish','authority':authority})
      assert fault is None, fault
      assert result['retiredContainers']==2 and result['filesDeleted']==4 and result['remainingContainers']==4
      retirement.close(); retirement=None
      # Same authenticated predecessors remain usable after partial/complete host retirement.
      again=m.Retirement(h,c,authority)
      assert again.prepared()['alreadyAbsentContainers']==2
      for index in range(2): assert again.step({'action':'retire','index':index,'authority':authority})['filesDeleted']==0
      assert again.finish({'action':'finish','authority':authority})['retiredContainers']==0
      again.close()
    except (ValueError,h.ReleaseError) as error:
      assert fault is not None, str(error)
      if fault in ['hash','partial']:
        assert 'retire_file_hash' in str(error); assert retirement.inflight
        assert m.TARGETS[0]['containerId'] not in by_id and m.TARGETS[1]['containerId'] in by_id
        assert not (dirs['obsoleteA']/'generation'/'details.sqlite').exists()
        assert target_path.exists() and (dirs['obsoleteB']/'generation'/'details.sqlite').exists()
        # Repair a synthetic test corruption, then resume using real helper idempotence.
        retirement.close(); retirement=None
        target_path.write_bytes(b'obsoleteAquery.sqlite')
        resumed=m.Retirement(h,c,authority)
        assert resumed.prepared()['alreadyAbsentContainers']==1
        assert resumed.step({'action':'retire','index':0,'authority':authority})['filesDeleted']==1
        resumed.step({'action':'retire','index':1,'authority':authority}); assert resumed.finish({'action':'finish','authority':authority})['completed']; resumed.close()
      elif fault=='dangling':
        assert str(error)=='obsolete_retirement_step_result' and retirement.inflight
        late_link=dirs['obsoleteA']/'generation'/'details.sqlite'
        assert not late_link.exists() and late_link.is_symlink()
        assert m.TARGETS[0]['containerId'] not in by_id and m.TARGETS[1]['containerId'] in by_id
        assert (dirs['obsoleteB']/'generation'/'details.sqlite').exists()
      else: assert not any(method!='GET' for method,_ in operations), operations
    finally:
      if retirement: retirement.close()
    for name in dirs:
      assert (dirs[name]/'ACCEPTED.json').exists() and (dirs[name]/'generation'/'GENERATION.json').exists()
    assert len(images)==7 and h.CONFIG.read_bytes()==b'proxy_pass http://127.0.0.1:3007;'
print('real helper retirement, hash refusal, partial preservation and idempotence passed')
`;
  assert.match(execFileSync('python3', ['-B', '-c', python], {cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024}), /real helper retirement/);
});
