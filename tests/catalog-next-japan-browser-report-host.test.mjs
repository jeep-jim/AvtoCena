import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sourcePriceOrderReport} from './helpers/japan-source-price-order-report-fixture.mjs';
import {verifyJapanCrossoverAppend} from '../scripts/catalog-next/japan-crossover-browser.mjs';

const hostFile = fileURLToPath(new URL('../scripts/catalog-next/release-host.py', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
function completeReport() {
  const value = sourcePriceOrderReport(), cursor = 'j2.k.2.0.2.' + hash('crossover') + '.' + hash('epoch') + '.-';
  const rows = Array.from({length: 48}, (_, i) => ({id: 'ajes-stats-crossover-' + i, bodyType: 'suv', powerHp: i < 30 ? 150 : null}));
  const items = rows.slice(24).map(row => ({id: row.id, market: 'japan', bodyType: 'suv',
    ...(row.powerHp === null ? {japanPowerUnknown: true} : {japanSupplierPower: {offerId: row.id, hp: row.powerHp, unit: 'hp', source: 'ajes_pw'}})}));
  const page = {observedAt: '2026-11-28T11:59:00.000Z', sourcePages: 1, receiptsSha256: hash('receipts'), sourceReceiptsFresh: true, shown: 24};
  Object.assign(value, {japanCrossoverPower160Required: true, japanCrossoverPower160Passed: true});
  value.checks.crossoverPower160 = {contract: 'japan-crossover-power160-browser-v1', city: 'Новокузнецк', bodyType: 'suv', powerTo: 160,
    documentStatus: 200, ...verifyJapanCrossoverAppend({before: rows.slice(0, 24), items, after: rows}),
    firstPage: {...page, kind: 'rendered-ssr', page: 1, afterSha256: hash(''), ssrBindingMatched: true},
    nextPage: {...page, kind: 'append-api', status: 200, stale: false, partial: false, interrupted: false, total: null},
    cursor, continuationCursor: cursor, sameFilter: true, cityPreserved: true, bodyControlPreserved: true,
    powerControlPreserved: true, followedEmittedCursor: true, explicitApiReads: 0, ordinaryAppendRequests: 1,
    liveExhaustiveScan: false, pageErrors: 0, alerts: 0};
  return value;
}

// Real report decoders, functional validators, byte hashes, acceptance and
// recovery run against isolated files. Only deployment I/O and root ownership
// are substituted; no socket, subprocess or provider request can run.
const harness = String.raw`
import base64,copy,contextlib,importlib.util,io,json,pathlib,stat,sys,tempfile
s=importlib.util.spec_from_file_location('host',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
sample=json.load(sys.stdin);case=sys.argv[2]
def forbidden(*a,**k):raise AssertionError('external I/O forbidden')
m.socket.socket=forbidden;m.subprocess.run=forbidden;m.health=forbidden;m.command=forbidden
def refused(fn,code):
 try:fn()
 except m.ReleaseError as e:assert str(e)=='china_host_'+code,str(e)
 else:raise AssertionError('required rejection: '+code)
def encode(raw):return base64.b64encode(raw).decode()
def padded(value,size):
 value={**value,'offlinePadding':''};raw=m.json_bytes(value);assert len(raw)<=size
 value['offlinePadding']='x'*(size-len(raw));raw=m.json_bytes(value);assert len(raw)==size
 return raw
@contextlib.contextmanager
def fixture():
 with tempfile.TemporaryDirectory(prefix='japan-report-host-') as temporary:
  root=pathlib.Path(temporary);root.chmod(0o700);m.BASE=root/'releases';m.BASE.mkdir(mode=0o700)
  def regular(filename,maximum=None):
   info=filename.lstat()
   m.need(filename.resolve().is_relative_to(root) and stat.S_ISREG(info.st_mode) and info.st_nlink==1 and not filename.is_symlink(),'regular_file')
   if maximum is not None:m.need(info.st_size<=maximum,'file_size')
   return info
  m.regular=regular
  m.private_directory=lambda directory:m.need(directory.resolve().is_relative_to(root) and directory.is_dir() and not directory.stat().st_mode&0o022,'recovery_directory')
  runtime,pricing,nonce='a'*40,'b'*40,'c'*32
  retained=m.JAPAN_STABILITY_SOURCE_PRICE_ORDER_RETAINED;retained_image=m.JAPAN_STABILITY_SOURCE_PRICE_ORDER_RETAINED_IMAGE
  generation={'runtimeSha':pricing,'source':{'cursor':8,'sourceObservedAt':'2026-11-28T00:00:00Z'}}
  manifest=m.json_bytes(generation);manifest_sha=m.sha(manifest)
  reference={'market':'china','runtimeSha':retained,'pricingRuntimeSha':pricing,'imageId':retained_image,
   'generationId':'gen_china_123_1','generationManifestSha256':manifest_sha,'receiptSha256':'d'*64,
   'sourceDescriptorSha256':'e'*64,'sourceCursor':8,'sourceObservedAt':generation['source']['sourceObservedAt']}
  receipt={'version':1,'kind':'china-host-acceptance-v1','release':retained,'nonce':'f'*32,
   'pricingRuntimeSha':pricing,'imageId':retained_image,'generationId':reference['generationId'],
   'generationManifestSha256':manifest_sha,'privateGenerationReceiptSha256':reference['receiptSha256'],
   'sourceDescriptorSha256':reference['sourceDescriptorSha256'],'sourceCursor':8,
   'sourceObservedAt':reference['sourceObservedAt'],'acceptedAt':'2026-11-28T01:00:00Z'}
  receipt_raw=m.json_bytes(receipt)
  reference['proof']={'kind':'china-accepted-proof-v1','hostReceiptBase64':encode(receipt_raw),'hostReceiptSha256':m.sha(receipt_raw)}
  previous={'version':1,'kind':'china-accepted-state-v1','market':'china','revision':2,'pending':None,'current':reference,
   'commit':{'nonce':receipt['nonce'],'acceptedAt':receipt['acceptedAt']}}
  image=m.json_bytes({'runtimeFiles':sorted(m.JAPAN_STABILITY_SOURCE_SELECTION_CODE_FILES),'countAcceptance':m.JAPAN_SOURCE_COUNT_POLICY})
  contents={name:manifest if name=='GENERATION.json' else image if name=='image-receipt.json' else b'offline-fixture' for name in m.CODE_UPLOAD_FILES|m.GENERATION_FILES}
  def descriptor(name,raw):return {'name':name,'bytes':len(raw),'sha256':'32fba449b77e40983803483ea7b6cb4ece09afa997c2ae08dd968c675f528c59' if name=='accepted-speed-baseline.json' else m.sha(raw),'compressedBytes':len(raw)+1,'compressedSha256':'1'*64}
  plan={'version':1,'market':'china','mode':'code-update','codeScope':m.JAPAN_STABILITY_CODE_SCOPE,
   'acceptancePolicy':m.JAPAN_OBSERVED_TIMING_POLICY,'countAcceptance':m.JAPAN_SOURCE_COUNT_POLICY,
   'retainedRuntime':retained,'runtimeSha':runtime,'pricingRuntimeSha':pricing,'runtimeTree':'2'*40,'controllerSha':'3'*40,
   'runtimeDiffSha256':'4'*64,'servingCalculationVersion':m.CALCULATION,'generationId':reference['generationId'],
   'generationManifestSha256':manifest_sha,'privateGenerationReceiptSha256':reference['receiptSha256'],
   'sourceDescriptorSha256':reference['sourceDescriptorSha256'],'imageId':'sha256:'+'5'*64,'nonce':nonce,
   'previousAcceptedState':previous,'previousAcceptedETag':'"previous"','previousAcceptedStateSha256':m.canonical_sha(previous),
   'codeSourcePlanSha256':'6'*64,'codeSourceOracleSha256':'7'*64,
   'files':[descriptor(name,raw) for name,raw in contents.items()]}
  m.validate_plan(plan)
  directory=m.BASE/runtime/'china-next'/nonce;directory.mkdir(mode=0o700,parents=True)
  for folder in (directory.parent,directory.parent.parent):folder.chmod(0o700)
  generation_dir=directory/'generation';generation_dir.mkdir(mode=0o700)
  m.new_file(directory/'PLAN.json',m.json_bytes(plan));m.new_file(generation_dir/'GENERATION.json',manifest)
  m.new_file(directory/'image-receipt.json',image);server={'observed':True};m.new_file(directory/'SERVER_TIMING.json',m.json_bytes(server))
  host=m.Host.__new__(m.Host);host.plan=plan;host.directory=directory;host.generation=generation_dir
  host.switched=True;host.accepted=False;host.functional_passed=True;host.timing_observed=True;host.speed_passed=False
  host.verdict_deadline=m.time.monotonic()+600;host.verify_candidate=lambda:None;host.candidate='8'*64
  host.retained={'Id':'9'*64,'Image':retained_image};operations=[]
  def docker(method,target,body=None):
   assert method=='POST' and target=='/containers/'+host.candidate+'/update' and body=={'RestartPolicy':{'Name':'unless-stopped','MaximumRetryCount':0}}
   operations.append((method,target));return None
  m.docker=docker
  timing={'timingPolicy':m.JAPAN_OBSERVED_TIMING_POLICY,'speedGateRequired':False,'speedPassed':None,'timingObserved':True}
  oracle_sha=next(row['sha256'] for row in plan['files'] if row['name']=='acceptance.json')
  report=copy.deepcopy(sample);report.update(version=1,kind='catalog-japan-browser-v1',codeScope=plan['codeScope'],
   release=runtime,nonce=nonce,generationManifestSha256=manifest_sha,oracleSha256=oracle_sha,**timing)
  for key in ('passed','japanFreshnessPassed','japanPowerApiPassed','japanUiPassed','japanVisibilityPassed','readOnlyBrowserFence',
   'japanPetrolPowerUiPassed','japanDetailPowerInputPassed','japanDeliveredCalculationPassed','japanFullPagesPassed',
   'japanPagination24Passed','japanCatalogWarningRemovedPassed','japanModelSelectionPassed','japanCombinedFiltersPassed',
   'japanRelatedCardsPassed','japanVehiclePolicyPassed','japanPowerOrderPassed','japanBrandDirectoryPassed'):report[key]=True
  report.update(productionMutations=0,directSupplierApiRequests=0,japanPreviewCalculationRequests=1)
  retry_fixture=m.json_bytes({'version':1,'kind':'japan-photo-retry-browser-v1','passed':True,'widths':[1440,390],'caseCount':12,
   'checks':{key:True for key in ('transientRecovery','persistentFailureBound','sourceChangeCancellation','unmountCancellation','exactUrl','noExternalRequests','protectedPhotoPreserved','lazyLoadRecovery')}})
  retry=m.json_bytes({'version':1,'kind':'japan-photo-retry-proof-v1','codeScope':plan['codeScope'],'release':runtime,'nonce':nonce,
   'checkedAt':'2026-11-28T12:00:00.000Z','oracleSha256':oracle_sha,'fixtureBase64':encode(retry_fixture),'fixtureSha256':m.sha(retry_fixture),
   'passed':True,'directSupplierRequests':0,'productionMutations':0})
  def reports(japan_size=256*1024,details_size=512*1024,change=None):
   value=copy.deepcopy(report)
   if change:change(value)
   speed=padded(value,japan_size)
   details={'kind':'japan-code-browser-details-v1','release':runtime,'nonce':nonce,'passed':True,
    'generationManifestSha256':manifest_sha,'precedingSpeedReportSha256':m.sha(speed),'countAcceptance':m.JAPAN_SOURCE_COUNT_POLICY,
    **timing,'retainedChinaOraclePassed':True,'unrelatedBrowserBenchmarksExecuted':False,'serverTiming':server,
    'japanPhotoRetryReportBase64':encode(retry),'japanPhotoRetryReportSha256':m.sha(retry),
    'japanReportBase64':encode(speed),'japanReportSha256':m.sha(speed)}
   raw=padded(details,details_size)
   verdict={'release':runtime,'nonce':nonce,'passed':True,'functionalPassed':True,'countAcceptance':m.JAPAN_SOURCE_COUNT_POLICY,
    **timing,'speedReportSha256':m.sha(speed),'detailsReportSha256':m.sha(raw),'reportSha256':m.sha(speed+raw)}
   return speed,raw,verdict
  def submit(speed,details):return host.browser_evidence({'speedBase64':encode(speed),'detailsBase64':encode(details)})
  yield host,reports,submit,operations

if case=='bounds':
 observed={'mode':'code-update','codeScope':m.JAPAN_STABILITY_CODE_SCOPE,'acceptancePolicy':m.JAPAN_OBSERVED_TIMING_POLICY}
 assert m.browser_report_limit(observed,'BROWSER_DETAILS.json')==512*1024
 assert m.browser_report_limit(observed,'BROWSER_SPEED.json')==256*1024
 for scope in (m.JAPAN_CODE_SCOPE,m.JAPAN_COMPLETION_CODE_SCOPE,m.JAPAN_COMPLETION_V2_CODE_SCOPE,
               m.JAPAN_USABILITY_CODE_SCOPE,m.JAPAN_PAGINATION_CODE_SCOPE,m.JAPAN_STABILITY_CODE_SCOPE):
  plan={'mode':'code-update','codeScope':scope}
  assert m.browser_report_limit(plan,'BROWSER_DETAILS.json')==256*1024
  assert m.browser_report_limit(plan,'BROWSER_SPEED.json')==256*1024
 for scope in (m.PHOTO_CODE_SCOPE,m.PHOTO_JAPAN_CODE_SCOPE,m.CRM_CHINA_CODE_SCOPE,m.CRM_JAPAN_PHOTO_CODE_SCOPE):
  assert m.browser_report_limit({'mode':'code-update','codeScope':scope},'BROWSER_DETAILS.json')==256*1024
 assert m.browser_report_limit({'mode':'generation-update','codeScope':m.JAPAN_STABILITY_CODE_SCOPE},'BROWSER_DETAILS.json')==256*1024
 for maximum in (256*1024,512*1024):
  raw=padded({'offline':True},maximum);assert m.decode_report(encode(raw),maximum)[0]==raw
  refused(lambda:m.decode_report(encode(padded({'offline':True},maximum+1)),maximum),'browser_evidence_encoding')
  refused(lambda:m.decode_report(encode(padded({'offline':True},maximum+3)),maximum),'browser_evidence_size')
 refused(lambda:m.decode_report(encode(padded({'offline':True},256*1024+3))),'browser_evidence_size')
 for invalid in ('!!!','eyJhIjoxfR==','eyJhIjoxfQ==\n'):
  refused(lambda:m.decode_report(invalid),'browser_evidence_encoding')
elif case=='accept_recover':
 with fixture() as (host,reports,submit,operations):
  speed,details,verdict=reports();assert len(speed)==256*1024 and len(details)==512*1024
  assert submit(speed,details)=={'saved':True,'speedReportSha256':m.sha(speed),'detailsReportSha256':m.sha(details)}
  accepted=host.accept(verdict);assert accepted['accepted'] is True and host.accepted and len(operations)==1
  outcome=m.read_outcome({'runtimeSha':host.plan['runtimeSha'],'nonce':host.plan['nonce']},verify_current=False)
  assert base64.b64decode(outcome['browserSpeedBase64'])==speed and base64.b64decode(outcome['browserDetailsBase64'])==details
  reference={**host.plan['previousAcceptedState']['current'],'runtimeSha':host.plan['runtimeSha'],'imageId':host.plan['imageId'],
   'proof':{'kind':'china-accepted-proof-v1','hostReceiptBase64':outcome['hostReceiptBase64'],'hostReceiptSha256':outcome['hostReceiptSha256']}}
  saved=m.verified_history(reference);assert saved['browser']==verdict
elif case=='binding_failures':
 changes=[lambda x:x.update(nonce='0'*32),lambda x:x.update(passed=False),lambda x:x.update(productionMutations=1),
  lambda x:x.update(japanSourcePriceOrderPassed=False),lambda x:x.update(japanCrossoverPower160Passed=False)]
 for index,change in enumerate(changes):
  with fixture() as (host,reports,submit,operations):
   speed,details,_=reports(change=change)
   refused(lambda:submit(speed,details),'browser_evidence_binding' if index in (0,1) else 'japan_browser_binding')
   assert not operations and not (host.directory/'BROWSER_SPEED.json').exists() and not (host.directory/'BROWSER_DETAILS.json').exists()
 with fixture() as (host,reports,submit,operations):
  speed,details,_=reports();value=json.loads(details);value['japanReportSha256']='0'*64
  refused(lambda:submit(speed,m.json_bytes(value)),'japan_browser_binding')
  host.verdict_deadline=m.time.monotonic()-1
  refused(lambda:submit(speed,details),'browser_evidence_phase');assert not operations
elif case=='stored_bounds':
 for stage in ('accept','recover'):
  with fixture() as (host,reports,submit,operations):
   speed,details,verdict=reports();submit(speed,details)
   if stage=='recover':host.accept(verdict)
   filename=host.directory/'BROWSER_DETAILS.json';filename.chmod(0o600);filename.write_bytes(details+b' ')
   if stage=='accept':refused(lambda:host.accept(verdict),'file_size');assert not host.accepted and not operations
   else:refused(lambda:m.read_outcome({'runtimeSha':host.plan['runtimeSha'],'nonce':host.plan['nonce']},verify_current=False),'file_size')
 with fixture() as (host,reports,submit,operations):
  speed,details,verdict=reports();submit(speed,details)
  filename=host.directory/'BROWSER_DETAILS.json';filename.chmod(0o600);filename.write_bytes(details.replace(b'xxx',b'yxx',1))
  refused(lambda:host.accept(verdict),'browser_evidence_hash');assert not host.accepted and not operations
elif case=='ingestion_bounds':
 for speed_size,details_size in ((256*1024+1,512*1024),(256*1024,512*1024+1)):
  with fixture() as (host,reports,submit,operations):
   speed,details,_=reports(speed_size,details_size)
   refused(lambda:submit(speed,details),'browser_evidence_encoding')
   assert not operations and not (host.directory/'BROWSER_DETAILS.json').exists()
 with fixture() as (host,reports,submit,operations):
  speed,details,_=reports();host.plan={**host.plan,'codeScope':m.PHOTO_JAPAN_CODE_SCOPE};host.plan.pop('acceptancePolicy')
  refused(lambda:submit(speed,details),'browser_evidence_size');assert not operations
 for size in (128*1024,128*1024+1):
  with fixture() as (host,reports,submit,operations):
   original,_,_=reports();japan=json.loads(original);japan.pop('offlinePadding');japan['codeScope']=m.JAPAN_CODE_SCOPE
   host.plan={**host.plan,'codeScope':m.JAPAN_CODE_SCOPE};host.plan.pop('acceptancePolicy');host.plan.pop('countAcceptance')
   japan_raw=padded(japan,size);speed=m.json_bytes({'release':host.plan['runtimeSha'],'passed':True,'browserPassed':True,'speedGuard':{'passed':True}})
   details=m.json_bytes({'kind':'china-browser-details-v1','release':host.plan['runtimeSha'],'nonce':host.plan['nonce'],'passed':True,
    'generationManifestSha256':host.plan['generationManifestSha256'],'precedingSpeedReportSha256':m.sha(speed),
    'japanReportBase64':encode(japan_raw),'japanReportSha256':m.sha(japan_raw)})
   if size==128*1024:assert submit(speed,details)['saved'] is True
   else:refused(lambda:submit(speed,details),'japan_browser_binding')
elif case=='protocol':
 real_host=m.Host;messages=[];calls=[]
 class FakeHost:
  def __init__(self,plan):self.plan=plan;self.switched=False;self.accepted=False;self.lock=None
  def browser_evidence(self,params):calls.append('browser_evidence');return {'saved':True}
  def speed(self):calls.append('speed');return {}
  def cleanup(self):pass
  def close(self):pass
 m.Host=FakeHost;m.emit=lambda value:messages.append(value)
 def line(method,size):
  value={'id':2,'method':method,'params':{'padding':''}};raw=m.json_bytes(value)+b'\n'
  value['params']['padding']='x'*(size-len(raw));raw=m.json_bytes(value)+b'\n';assert len(raw)==size;return raw
 def exercise(raw,expected=None):
  messages.clear();calls.clear()
  stream=m.json_bytes({'id':1,'method':'init','params':{'plan':{}}})+b'\n'+raw+m.json_bytes({'id':3,'method':'close'})+b'\n'
  m.sys.stdin=io.TextIOWrapper(io.BytesIO(stream))
  if expected:refused(m.main,expected);assert not calls
  else:m.main();assert messages[-1]['kind']=='result'
 exercise(line('speed',1024*1024));assert calls==['speed']
 exercise(line('speed',1024*1024+1),'protocol_input')
 exercise(line('browser_evidence',2*1024*1024));assert calls==['browser_evidence']
 exercise(line('browser_evidence',2*1024*1024+1),'protocol_input')
 pair=m.json_bytes({'id':2,'method':'browser_evidence','params':{'speedBase64':encode(padded({},256*1024)),'detailsBase64':encode(padded({},512*1024))}})+b'\n'
 assert 1024*1024<len(pair)<2*1024*1024;exercise(pair);assert calls==['browser_evidence']
else:raise AssertionError('unknown test case')
print('ok')
`;

for (const [name, scenario] of [
  ['Japan-specific decoded and canonical Base64 limits retain every other scope', 'bounds'],
  ['complete source-price/crossover report survives ingest, acceptance, recovery and history at both exact caps', 'accept_recover'],
  ['larger capacity preserves identity, functional, crossover, hash and deadline rejection', 'binding_failures'],
  ['stored proof rereads reject oversized or modified details before acceptance or recovery', 'stored_bounds'],
  ['report ingestion rejects one byte over either cap and keeps photo-Japan details at 256 KiB', 'ingestion_bounds'],
  ['host protocol allows the bounded browser envelope and keeps every other method at 1 MiB', 'protocol'],
]) test(name, () => {
  const result = spawnSync('python3', ['-I', '-B', '-c', harness, hostFile, scenario], {
    input: JSON.stringify(completeReport()), encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), 'ok');
});
