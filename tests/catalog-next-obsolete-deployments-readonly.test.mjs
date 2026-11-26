import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createChinaState} from '../scripts/catalog-next/china-state.mjs';
import {validateChinaGenerationRetirementWitness} from '../scripts/catalog-next/china-generation-gc.mjs';
import {fixture as gcFixture} from './helpers/catalog-next-gc-fixture.mjs';
import {REPORT, MARKER, OPERATION, verifyInvocation, localDefinition, createReadonlyQueueReader,
  checkedTask, readSnapshot, verifyState, sanitizeHostReport, runCapture}
  from '../scripts/catalog-next/inspect-obsolete-deployments-20261127.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const plan = localDefinition(ROOT), copy = value => structuredClone(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const bytes = value => Buffer.from(JSON.stringify(ordered(value)));
const absent = () => ({found: false, etag: null, sha256: null, value: null});
const PRIVATE = 'synthetic-private-value-must-never-appear';
const observed = value => ({found: true, etag: '"' + PRIVATE + '"', sha256: hash(bytes(value)), value: copy(value)});
const clock = () => '2026-11-26T18:00:00.000Z';
const workflow = 'jeep-jim/AvtoCena/.github/workflows/catalog-next-obsolete-deployments-20261127-readonly.yml@refs/heads/main';

function evidence(reference, nonce, intent) {
  const speed = Buffer.from(JSON.stringify({release: reference.runtimeSha, passed: true, browserPassed: true, speedGuard: {passed: true}}));
  const details = Buffer.from(JSON.stringify({kind: 'china-browser-details-v1', release: reference.runtimeSha, nonce,
    passed: true, generationManifestSha256: reference.generationManifestSha256, precedingSpeedReportSha256: hash(speed)}));
  const receipt = {version: 1, kind: 'china-host-acceptance-v1', release: reference.runtimeSha,
    pricingRuntimeSha: reference.pricingRuntimeSha, generationId: reference.generationId,
    generationManifestSha256: reference.generationManifestSha256, privateGenerationReceiptSha256: reference.receiptSha256,
    sourceDescriptorSha256: reference.sourceDescriptorSha256, sourceCursor: reference.sourceCursor,
    sourceObservedAt: reference.sourceObservedAt, imageId: reference.imageId, nonce, acceptedAt: clock(),
    retainedContainerId: '3'.repeat(64), private: PRIVATE,
    browser: {release: reference.runtimeSha, nonce, passed: true, functionalPassed: true, speedPassed: true,
      speedReportSha256: hash(speed), detailsReportSha256: hash(details), reportSha256: hash(Buffer.concat([speed, details]))}};
  if (intent) Object.assign(receipt, {transition: 'code-update', previousAcceptedETag: intent.value.previous.etag,
    previousAcceptedStateSha256: intent.value.previous.sha256, retainedRuntimeSha: intent.value.previous.value.current.runtimeSha,
    retainedImageId: intent.value.previous.value.current.imageId});
  const raw = Buffer.from(JSON.stringify(receipt));
  return {hostReceiptBase64: raw.toString('base64'), hostReceiptSha256: hash(raw), browserSpeedBytes: speed, browserDetailsBytes: details};
}

async function nativeState() {
  const values = new Map(), reads = [], writes = []; let sequence = 0;
  const storage = {async read(name) { reads.push(name); return copy(values.get(name) ?? absent()); },
    async compareAndSwap(name, previous, value) {
      assert.equal(previous.etag, (values.get(name) ?? absent()).etag); writes.push(name);
      values.set(name, {...observed(value), etag: '"' + PRIVATE + ++sequence + '"'});
    }};
  const state = createChinaState({storage, now: clock});
  const base = {market: 'china', generationId: 'gen_china_45655051136_1',
    owner: {runId: '45655051136', attempt: '1', revision: '1'.repeat(40)}, receiptSha256: '2'.repeat(64),
    sourceDescriptorSha256: '4'.repeat(64), generationManifestSha256: plan.definition.history.current.manifestSha256,
    sourceCursor: 123, sourceObservedAt: '2026-11-25T17:34:57.542Z', pricingRuntimeSha: '5'.repeat(40)};
  for (const [index, name] of ['rollback', 'current'].entries()) {
    const pin = plan.definition.history[name], nonce = String(index + 6).repeat(32);
    const lease = await state.acquireLease({previous: await state.read('lease'), owner: base.owner, nonce,
      expiresAt: '2026-11-26T19:00:00.000Z'});
    const candidate = {...base, runtimeSha: pin.runtimeSha, imageId: pin.imageId};
    const staged = await state.reserve({lease, previous: await state.read('accepted'), previousIntent: await state.read('intent'),
      candidate, ...(index ? {transition: 'code-update'} : {})});
    await state.commit({lease, ...staged, evidence: evidence(candidate, nonce, index ? staged.intent : undefined)});
    await state.releaseLease({lease});
  }
  reads.length = 0; writes.length = 0;
  return {values, reads, writes, reader: {assertPrivateBucket: async () => ({verified: true}), read: storage.read}};
}
const emptyQueue = () => ({assertPrivateBucket: async () => ({verified: true}), readQueue: async () => absent(),
  readTask: async () => assert.fail('no indexed task')});

function hostReport(snapshot) {
  const history = {};
  for (const [name, pin] of Object.entries(plan.definition.history)) {
    const old = name.startsWith('obsolete');
    history[name] = {...pin, referenceSha256: old ? 'a'.repeat(64) : hash(bytes(snapshot.raw.accepted.value[name])),
      nonceSha256: 'b'.repeat(64), hostReceiptSha256: pin.acceptedSha256, running: !old, generationVerified: true,
      ...(old ? {predecessorOf: name === 'obsoleteA' ? 'rollback' : 'current',
        previousAcceptedStateSha256: 'c'.repeat(64), previousAcceptedETagSha256: 'd'.repeat(64)} : {})};
  }
  return {version: 1, kind: 'obsolete-deployments-host-readonly-v1', readOnly: true,
    inventoryReportSha256: plan.definition.inventoryReportSha256, definitionSha256: plan.definitionSha256,
    acceptedStateSha256: snapshot.raw.accepted.sha256, intentSha256: snapshot.raw.intent.sha256, leaseSha256: snapshot.raw.lease.sha256,
    containersChecked: 6, containersUnchanged: true, ingressSha256: 'e'.repeat(64), ingressUnchanged: true, history,
    bulkFiles: [{deployment: 'obsoleteA', name: 'details.sqlite', present: true, declaredBytes: 9,
      declaredSha256: 'f'.repeat(64), allocatedBytes: 4096, contentHashVerified: false}],
    allocatedBulkBytes: 4096, diskAvailableBytes: 10000, bulkContentHashesVerified: false,
    supplierRequests: 0, storageWrites: 0, hostWrites: 0, localHealthRequests: 2};
}

test('selector pins the four accepted histories and six containers without any unused-image set', () => {
  assert.equal(plan.definition.containers.length, 6); assert.equal(Object.keys(plan.definition.history).length, 4);
  assert.equal(hash(bytes(plan.definition)), plan.definitionSha256);
  assert.equal(plan.definition.history.current.runtimeSha, '077cbb17626ab0c64e7f06db055fef9252ad21c0');
  assert.equal(plan.definition.history.rollback.runtimeSha, '36c7ea726e7f070d10dbc65afc6538f13c0c1a24');
  assert.equal(plan.definition.history.obsoleteA.generationId, 'gen_china_45369451603_1');
  assert.equal(plan.definition.history.obsoleteB.generationId, 'gen_china_45655051136_1');
  assert.equal(plan.definition.history.obsoleteA.attemptHash, '0ddc276f85ea2d45');
  assert.equal(plan.definition.history.obsoleteB.attemptHash, '6126db9e94c745c1');
  assert.doesNotMatch(JSON.stringify(plan.definition), /observedImage|240e721f/);
});

test('native valid current/rollback state and absent GC queue remain read only and private', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'obsolete-capture-')); t.after(() => fs.rm(root, {recursive: true, force: true}));
  const state = await nativeState(), queue = emptyQueue(), snapshot = await readSnapshot(state.reader, queue, clock);
  state.reads.length = 0;
  const original = copy([...state.values]), calls = [], logs = [];
  const report = await runCapture({root, now: clock, capabilities: {
    verifyInvocation: () => ({sourceSha: 'a'.repeat(40), approvedSourceSha: 'b'.repeat(40)}), verifyBaselines() {},
    localDefinition: () => plan, createStateReader: () => state.reader, createQueueReader: () => queue,
    readHost: async args => { calls.push(args.publicationState); return hostReport(snapshot); }}, log: row => logs.push(row)});
  assert.equal(report.completed, true); assert.equal(report.stateStable, true); assert.equal(report.cleanupAuthorized, false);
  assert.equal(report.host.bulkContentHashesVerified, false); assert.equal(report.host.localHealthRequests, 2);
  assert.deepEqual(state.writes, []); assert.deepEqual([...state.values], original); assert.equal(calls.length, 1);
  assert.deepEqual(state.reads.sort(), ['accepted','accepted','intent','intent','lease','lease']);
  const raw = await fs.readFile(path.join(root, REPORT), 'utf8');
  assert.doesNotMatch(raw, new RegExp(PRIVATE)); assert.doesNotMatch(raw, /Base64|"etag"|"nonce"|sourceCursor|privateKey/);
  assert.equal((await fs.stat(path.join(root, REPORT))).mode & 0o777, 0o600); assert.deepEqual(logs, [report]);
});

test('a changed lease or queue prevents a stable conclusion', async t => {
  for (const changed of ['lease', 'queue']) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'obsolete-change-')); t.after(() => fs.rm(root, {recursive: true, force: true}));
    const state = await nativeState(), queue = emptyQueue(), snapshot = await readSnapshot(state.reader, queue, clock);
    await assert.rejects(runCapture({root, now: clock, capabilities: {
      verifyInvocation: () => ({sourceSha: 'a'.repeat(40), approvedSourceSha: 'b'.repeat(40)}), verifyBaselines() {},
      localDefinition: () => plan, createStateReader: () => state.reader, createQueueReader: () => queue,
      readHost: async () => {
        if (changed === 'lease') { const next = copy(state.values.get('lease').value); next.epoch++; state.values.set('lease', observed(next)); }
        else queue.readQueue = async () => observed({version: 1, kind: 'china-generation-gc-queue-v1', market: 'china', revision: 1,
          rememberedPublication: null, items: []});
        return hostReport(snapshot);
      }}, log() {}}), /obsolete_capture_state_changed/);
    const report = JSON.parse(await fs.readFile(path.join(root, REPORT), 'utf8'));
    assert.equal(report.completed, false); assert.equal(report.stateStable, false); assert.equal(report.host.containersUnchanged, true);
  }
});

test('an unresolved, foreign runtime or held-lease state refuses before opening SSH', async () => {
  const state = await nativeState(), snapshot = await readSnapshot(state.reader, emptyQueue(), clock);
  verifyState(snapshot, plan.definition);
  for (const change of [s => { s.summary.state = 'reserved'; }, s => { s.raw.accepted.value.current.runtimeSha = 'a'.repeat(40); },
    s => { s.raw.lease.value.status = 'held'; }]) {
    const bad = copy(snapshot); change(bad); assert.throws(() => verifyState(bad, plan.definition), /obsolete_capture_(state|lease_active)/);
  }
});

test('host projection rejects private fields, wrong reference proofs, counters and unsafe types', async () => {
  const state = await nativeState(), snapshot = await readSnapshot(state.reader, emptyQueue(), clock), value = hostReport(snapshot);
  assert.deepEqual(sanitizeHostReport(value, snapshot, plan.definition, plan.definitionSha256), value);
  for (const mutate of [v => { v.private = PRIVATE; }, v => { v.history.obsoleteA.private = PRIVATE; },
    v => { v.history.current.referenceSha256 = '0'.repeat(64); }, v => { v.history.obsoleteA.predecessorOf = 'current'; },
    v => { v.history.obsoleteB.planSha256 = '0'.repeat(64); }, v => { v.history.rollback.nonceSha256 = PRIVATE; },
    v => { v.bulkFiles[0].declaredSha256 = PRIVATE; }, v => { v.bulkFiles[0].name = '/etc/passwd'; },
    v => { v.bulkFiles.push(copy(v.bulkFiles[0])); }, v => { v.storageWrites = 1; },
    v => { v.bulkContentHashesVerified = true; }, v => { v.diskAvailableBytes = Infinity; },
    v => { v.leaseSha256 = '0'.repeat(64); }]) {
    const bad = copy(value); mutate(bad);
    assert.throws(() => sanitizeHostReport(bad, snapshot, plan.definition, plan.definitionSha256), /obsolete_capture_host_(report|binding)/);
  }
});

test('private host errors and malformed host output are never echoed to the persisted artifact', async t => {
  for (const malformed of [true, false]) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'obsolete-private-')); t.after(() => fs.rm(root, {recursive: true, force: true}));
    const state = await nativeState();
    await assert.rejects(runCapture({root, now: clock, capabilities: {
      verifyInvocation: () => ({sourceSha: 'a'.repeat(40), approvedSourceSha: 'b'.repeat(40)}), verifyBaselines() {},
      localDefinition: () => plan, createStateReader: () => state.reader, createQueueReader: emptyQueue,
      readHost: async () => { if (malformed) return {secret: PRIVATE}; throw Error('obsolete_capture_' + PRIVATE); }}, log() {}}));
    const raw = await fs.readFile(path.join(root, REPORT), 'utf8'); assert.doesNotMatch(raw, new RegExp(PRIVATE));
    assert.equal(JSON.parse(raw).stateStable, true); assert.equal(JSON.parse(raw).completed, false);
  }
});

test('real queue witness is checked against its immutable task bytes and exact indexed identity', async t => {
  const f = await gcFixture(t), witness = validateChinaGenerationRetirementWitness({previousAccepted: f.second.accepted, acceptedPublication: f.third});
  const publication = {acceptedRevision: f.third.accepted.value.revision, acceptedSha256: f.third.accepted.sha256,
    intentSha256: f.third.intent.sha256, publicationNonce: f.third.intent.value.nonce};
  const id = hash(bytes({generationId: witness.reference.generationId, owner: witness.reference.owner,
    receiptSha256: witness.reference.receiptSha256, previousETag: witness.previousAccepted.etag,
    previousSha256: witness.previousAccepted.sha256, publication}));
  const raw = bytes({version: 1, kind: 'china-generation-gc-task-v1', market: 'china', id, ...witness});
  const item = {id, generationId: witness.reference.generationId, owner: witness.reference.owner,
    receiptSha256: witness.reference.receiptSha256, publicationNonce: publication.publicationNonce, taskSha256: hash(raw), phase: 'pending'};
  const value = {found: true, data: raw, size: raw.length, etag: '"' + PRIVATE + '"'};
  const result = checkedTask(value, item);
  assert.equal(result.witnessVerified, true); assert.doesNotMatch(JSON.stringify(result), /Base64|"etag"|"nonce"/);
  for (const bad of [{...item, id: '0'.repeat(64)}, {...item, taskSha256: '0'.repeat(64)},
    {...item, receiptSha256: '0'.repeat(64)}, {...item, publicationNonce: '0'.repeat(32)}])
    assert.throws(() => checkedTask(value, bad), /obsolete_capture_task/);
});

test('queue adapter exposes only GETs and only task IDs found in its validated current index', async () => {
  const env = {YC_OBJECT_STORAGE_ENDPOINT: 'https://s3.regru.cloud', YC_OBJECT_STORAGE_REGION: 'us-east-1',
    YC_OBJECT_STORAGE_BUCKET: 'avtocena-staging-8120751', YC_OBJECT_STORAGE_PREFIX: 'migration-staging/full-20261011/',
    YC_OBJECT_STORAGE_ACCESS_KEY_ID: 'synthetic', YC_OBJECT_STORAGE_SECRET_ACCESS_KEY: PRIVATE};
  const id = '1'.repeat(64), otherId = '2'.repeat(64), calls = [];
  const item = (identifier, runId) => ({id: identifier, generationId: `gen_china_${runId}_1`, owner: {runId, attempt: '1', revision: 'a'.repeat(40)},
    receiptSha256: '3'.repeat(64), publicationNonce: '4'.repeat(32), taskSha256: '5'.repeat(64), phase: 'pending'});
  let items = [item(id, '45369451603'), item(otherId, '12345')];
  const reader = createReadonlyQueueReader({environment: env, fetcher: async (url, init) => {
    calls.push({url: new URL(url), method: init.method, body: init.body});
    if (new URL(url).searchParams.has('acl')) return new Response('<AccessControlPolicy><Owner><ID>owner</ID></Owner><AccessControlList><Grant><Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>owner</ID></Grantee><Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>');
    if (new URL(url).searchParams.has('policy')) return new Response('<Error><Code>NoSuchBucketPolicy</Code></Error>', {status: 404});
    if (new URL(url).pathname.endsWith('/queue.json')) return new Response(bytes({version: 1, kind: 'china-generation-gc-queue-v1', market: 'china',
      revision: 1, rememberedPublication: null, items}), {headers: {etag: '"q"'}});
    return new Response('{}', {headers: {etag: '"t"'}});
  }});
  assert.deepEqual(Object.keys(reader).sort(), ['assertPrivateBucket', 'readQueue', 'readTask']);
  assert.throws(() => reader.readTask(id), /unindexed_task/);
  await reader.assertPrivateBucket(); await reader.readQueue(); await reader.readTask(id);
  assert.throws(() => reader.readTask(otherId), /unindexed_task/);
  items = []; await reader.readQueue(); assert.throws(() => reader.readTask(id), /unindexed_task/);
  assert(calls.every(row => row.method === 'GET' && row.body === undefined));
  assert(!calls.some(row => row.url.pathname.includes(otherId))); assert(!calls.some(row => row.url.searchParams.has('list-type')));
});

test('marker-only exact repository/ref/workflow/attempt authorization is preserved', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'obsolete-marker-')); t.after(() => fs.rm(root, {recursive: true, force: true}));
  const git = args => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  git(['init', '-b', 'main']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']);
  await fs.writeFile(path.join(root, 'controller'), 'reviewed'); git(['add', '.']); git(['commit', '-m', 'approved']);
  const parent = git(['rev-parse', 'HEAD']); await fs.mkdir(path.join(root, '.github/market-runs'), {recursive: true});
  await fs.writeFile(path.join(root, MARKER), JSON.stringify({version: 1, operation: OPERATION, approvedSourceSha: parent}));
  git(['add', '.']); git(['commit', '-m', 'marker']); const head = git(['rev-parse', 'HEAD']);
  const event = path.join(root, 'event.json'); await fs.writeFile(event, JSON.stringify({before: parent, after: head,
    ref: 'refs/heads/main', created: false, deleted: false, forced: false}));
  const environment = {GITHUB_REPOSITORY: 'jeep-jim/AvtoCena', GITHUB_REPOSITORY_ID: '1289722938', GITHUB_REF: 'refs/heads/main',
    GITHUB_RUN_ATTEMPT: '1', GITHUB_EVENT_NAME: 'push', GITHUB_WORKFLOW_REF: workflow, GITHUB_JOB: 'inspect', GITHUB_SHA: head, GITHUB_EVENT_PATH: event};
  assert.equal(verifyInvocation({root, environment}).approvedSourceSha, parent);
  for (const patch of [{GITHUB_EVENT_NAME: 'workflow_dispatch'}, {GITHUB_REPOSITORY: 'other/repo'}, {GITHUB_REF: 'refs/heads/test'},
    {GITHUB_RUN_ATTEMPT: '2'}, {GITHUB_WORKFLOW_REF: workflow.replace('readonly', 'cleanup')}])
    assert.throws(() => verifyInvocation({root, environment: {...environment, ...patch}}));
});

test('host guards reject Docker mutations, unrelated GETs and non-health local routes', () => {
  const python = String.raw`
import importlib.util, types
spec=importlib.util.spec_from_file_location('capture','scripts/catalog-next/inspect-obsolete-deployments-20261127.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
calls=[]
h=types.SimpleNamespace(docker=lambda *args: calls.append(args), response_json=lambda *args: calls.append(args))
m.readonly_host(h)
h.docker('GET','/containers/json?all=1'); h.docker('GET','/containers/'+m.CONTAINERS[0][0]+'/json'); h.response_json(3007,'/api/health',5)
for method,target,body in [('DELETE','/containers/'+m.CONTAINERS[0][0],None),('POST','/containers/create',{}),('GET','/images/json?all=1',None),('GET','/containers/'+'f'*64+'/json',None),('GET','/containers/json?all=1',{})]:
    try: h.docker(method,target,body); raise AssertionError('unsafe Docker call admitted')
    except ValueError: pass
for port,route in [(3007,'/api/catalog/search'),(80,'/api/health'),(3005,'/api/health')]:
    try: h.response_json(port,route); raise AssertionError('unsafe HTTP call admitted')
    except ValueError: pass
assert len(calls)==3
print('readonly guards passed')
`;
  assert.match(execFileSync('python3', ['-B', '-c', python], {cwd: ROOT, encoding: 'utf8'}), /readonly guards passed/);
});

test('production transport has no helper upload, host initialization, state writes or supplier API', async () => {
  const script = await fs.readFile(path.join(ROOT, 'scripts/catalog-next/inspect-obsolete-deployments-20261127.mjs'), 'utf8');
  const python = await fs.readFile(path.join(ROOT, 'scripts/catalog-next/inspect-obsolete-deployments-20261127.py'), 'utf8');
  assert.doesNotMatch(script, /\.acquireLease\(|\.compareAndSwap\(|\.releaseLease\(|\.reserve\(|\.readTask\([^i]|\bscp\b/);
  assert.doesNotMatch(python, /\.unlink\(|\.mkdir\(|\.write_bytes\(|\.write_text\(|\.Host\(|retire_reference\(|file_sha\(/);
  assert.match(python, /os\.O_RDONLY \| os\.O_NOFOLLOW/); assert.doesNotMatch(python, /os\.O_CREAT|os\.O_WRONLY|os\.O_RDWR/);
  assert.match(script, /python3 -I -B -c /); assert.match(python, /'bulkContentHashesVerified': False/);
  const workflowText = await fs.readFile(path.join(ROOT, '.github/workflows/catalog-next-obsolete-deployments-20261127-readonly.yml'), 'utf8');
  assert.match(workflowText, /group: catalog-next-china/); assert.doesNotMatch(workflowText, /workflow_dispatch|schedule:|contents: write/);
});

test('host capture follows actual predecessor plans and refuses a changed chain, shared mount or changed proof', () => {
  const python = String.raw`
import copy, importlib.util, json, pathlib, tempfile, types
spec=importlib.util.spec_from_file_location('capture','scripts/catalog-next/inspect-obsolete-deployments-20261127.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
original=copy.deepcopy(m.HISTORY)
for fault in [None,'chain','mount','proof']:
  m.HISTORY=copy.deepcopy(original)
  with tempfile.TemporaryDirectory() as temporary:
    base=pathlib.Path(temporary); config=base/'nginx'; config.write_bytes(b'proxy_pass http://127.0.0.1:3007;')
    refs={}; receipts={}; directories={}; plans={}; calls=[]; by_id={}
    for index,(name,pin) in enumerate(m.HISTORY.items()):
      nonce=str(index+1)*32; directory=base/pin['runtimeSha']/nonce; (directory/'generation').mkdir(parents=True)
      generation={'generationId':pin['generationId']}; generation_raw=json.dumps(generation).encode()
      (directory/'generation'/'GENERATION.json').write_bytes(generation_raw)
      pin['manifestSha256']=m.sha(generation_raw); pin['attemptHash']=m.sha(nonce.encode())[:16]
      receipt={'nonce':nonce}; accepted_raw=json.dumps(receipt).encode(); (directory/'ACCEPTED.json').write_bytes(accepted_raw)
      pin['acceptedSha256']=m.sha(accepted_raw)
      refs[name]={'runtimeSha':pin['runtimeSha'],'imageId':pin['imageId'],'generationId':pin['generationId'],
        'generationManifestSha256':pin['manifestSha256'],'proof':{'hostReceiptSha256':pin['acceptedSha256']}}
      receipts[name]=receipt; directories[name]=directory
      plans[name]={'files':[{'name':'details.sqlite','bytes':4,'sha256':m.sha(b'data')}]}
      (directory/'generation'/'details.sqlite').write_bytes(b'data')
    for parent,current,rollback in [('current','rollback','obsoleteB'),('rollback','obsoleteB','obsoleteA')]:
      prior={'current':refs[current],'rollback':refs[rollback]}
      if fault=='chain' and parent=='rollback': prior['current']=refs['obsoleteA']
      plans[parent].update(previousAcceptedState=prior,previousAcceptedETag='"synthetic-private-etag"',previousAcceptedStateSha256=m.sha(m.canonical(prior)))
    for name,pin in m.HISTORY.items():
      raw=json.dumps(plans[name]).encode(); (directories[name]/'PLAN.json').write_bytes(raw); pin['planSha256']=m.sha(raw)
    for identifier,running,_ in m.CONTAINERS:
      name=next((name for name,pin in m.HISTORY.items() if pin['containerId']==identifier),None)
      row={'Id':identifier,'Image':m.HISTORY[name]['imageId'] if name else 'unrelated','Mounts':[],
           'State':{'Running':running,'Pid':100 if running else 0},'HostConfig':{'PortBindings':{}},'Config':{}}
      if name:
        row['Mounts']=[{'Source':str(directories[name]/'generation'),'Destination':'/generation','RW':False}]
        row['HostConfig']['PortBindings']={'3000/tcp':[{'HostPort':str(m.HISTORY[name]['port'])}]}
      by_id[identifier]=row
    if fault=='mount': by_id[m.HISTORY['current']['containerId']]['Mounts'].append({'Source':str(directories['obsoleteA']),'Destination':'/foreign','RW':False})
    m.CONTAINERS=[(identifier,row['State']['Running'],m.configuration_sha(row)) for identifier,row in by_id.items()]
    h=types.SimpleNamespace(BASE=base,CONFIG=config,Path=pathlib.Path,HOST_BULK_FILES={'details.sqlite'})
    h.checked_publication_view=lambda view: (view['accepted']['value'],None)
    h.checked_accepted_observation=lambda value: value['value']
    h.regular=lambda filename,maximum=None: filename.stat()
    h.backend=lambda ingress:3007
    h.canonical_sha=lambda value:m.sha(m.canonical(value))
    h.protected_identity=lambda row:m.configuration_sha(row)
    def docker(method,route):
      assert method=='GET'; calls.append(route)
      return [{'Id':identifier} for identifier in by_id] if route=='/containers/json?all=1' else copy.deepcopy(by_id[route.split('/')[2]])
    h.docker=docker
    def name_of(reference): return next(name for name,value in refs.items() if value==reference)
    h.verified_history=lambda reference:receipts[name_of(reference)]
    h.reference_plan=lambda reference,receipt:(directories[name_of(reference)],plans[name_of(reference)])
    h.check_mounted_reference=lambda container,reference,nonce,require_running=True:{'verified':True}
    h.health=lambda port,runtime: calls.append(('health',port,runtime))
    reads={}
    def diagnosis(filename):
      reads[filename]=reads.get(filename,0)+1; raw=filename.read_bytes()
      if fault=='proof' and filename==directories['obsoleteA']/'PLAN.json' and reads[filename]>1: raw=b'{}'
      return json.loads(raw),raw
    h.diagnosis_json=diagnosis
    view={'accepted':{'sha256':'a'*64,'value':{'current':refs['current'],'rollback':refs['rollback']}},
          'intent':{'sha256':'b'*64},'lease':{'sha256':'c'*64,'value':{'status':'released'}}}
    if fault:
      try: m.inspect(h,view); raise AssertionError('unsafe capture completed '+fault)
      except ValueError as error:
        assert str(error) == 'obsolete_capture_'+{'chain':'predecessor_chain','mount':'obsolete_mount_shared','proof':'metadata_changed'}[fault]
    else:
      report=m.inspect(h,view)
      assert report['history']['obsoleteA']['predecessorOf']=='rollback'
      assert report['history']['obsoleteB']['predecessorOf']=='current'
      assert report['bulkContentHashesVerified'] is False and len(report['bulkFiles'])==2
      assert report['containersChecked']==6 and report['hostWrites']==0
      assert 'synthetic-private-etag' not in json.dumps(report)
      assert len([call for call in calls if isinstance(call,tuple)])==2
print('actual predecessor and unchanged proof guards passed')
`;
  assert.match(execFileSync('python3', ['-B', '-c', python], {cwd: ROOT, encoding: 'utf8'}), /actual predecessor and unchanged proof guards passed/);
});
