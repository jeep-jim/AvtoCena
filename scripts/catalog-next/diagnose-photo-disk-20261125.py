"""Bounded, read-only disk, rollback and retained AJ-failure evidence."""
import sys
PHOTO_ATTEMPT_ONLY = sys.argv[1:] == ['--photo-attempt-only']
if sys.argv[1:] and not PHOTO_ATTEMPT_ONLY:
    if sys.argv[1:] != ['--capacity-only']:
        raise SystemExit('photo_disk_arguments')
    import datetime, json, os
    usage = os.statvfs('/')
    print(json.dumps({
        'kind': 'photo-release-capacity-readonly-v1',
        'measuredAt': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z'),
        'diskFreeBytes': usage.f_bavail * usage.f_frsize,
        'diskTotalBytes': usage.f_blocks * usage.f_frsize,
    }, separators=(',', ':')), flush=True)
    raise SystemExit(0)

import datetime
import fcntl
import hashlib
import http.client
import json
import math
import os
from pathlib import Path
import re
import select
import shlex
import socket
import stat
import subprocess
import time
from urllib.parse import urlencode

BASE = Path('/opt/avtocena/releases')
CONFIG = Path('/etc/nginx/conf.d/avtocena-prepare.conf')
RUNTIMES = (
    '4302f59a0312f35a64fc3cb9c5b25f9463fa9294',
    'd536c1547c4d82a339ed68ced7d8503f09b6810b',
    '38895e53f7f770ee68edb0b8ad53056468b928a5',
    '36d707bcb599e861918df411e40d8947074f0430',
)
PHOTO_SPEED_PLAN = {
    'runtimeSha': RUNTIMES[3],
    'controllerSha': 'b6ae6d20149362e5d772d08f6ce66dcca3ee9332',
    'generationId': 'gen_china_45655051136_1',
    'generationManifestSha256': '6711203fb59a70c99cda3c725eb4ee70654142b1871b0784516209d2903c0b8d',
    'retainedRuntime': RUNTIMES[1],
    'mode': 'code-update',
    'codeScope': 'catalog-photo-recovery-v1',
}
PHOTO_SPEED_SOURCES = {
    'regcloud-performance-gate.py': 'ebd54f9774271f52d3026a153e99d3a96c791db07b79c9c802705e952045366b',
    'accepted-speed-baseline.json': '32fba449b77e40983803483ea7b6cb4ece09afa997c2ae08dd968c675f528c59',
}
PHOTO_ATTEMPT_PROOFS = {
    'PLAN.json': '1b8455abcd8512467f31bc0e2735922536cee40d933084ae3934ef38515c99dc',
    'ROLLED_BACK.json': '783809d2dc846fbac6c01699f5419345bb61eca77c6542d304eb283fed0d74e6',
    'server-speed-result.json': '4d4b236968365be4722537fc3e4e0c06a57f5364fe8470e6f280847fcc0d0187',
}
PHOTO_LOCK = Path('/run/lock/avtocena-runtime-change.lock')
PHOTO_CALCULATION = '4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90'
FILES = ('GENERATION.json', 'details.sqlite', 'query.sqlite',
         'FILTER_SEMANTICS.json', 'FX_RECEIPT.json', 'RECONCILIATION.json', 'DISPOSITIONS.ndjson')
PHASE = 'begin'
REPORT = {}


def ordinary(path):
    try:
        st = path.lstat()
        return stat.S_ISREG(st.st_mode) and st.st_uid == 0 and st.st_nlink == 1
    except FileNotFoundError:
        return False


def proof(path):
    if not ordinary(path) or path.stat().st_size > 256 * 1024:
        return {}
    try:
        value = json.loads(path.read_bytes())
        return value if isinstance(value, dict) else {'_invalidJson': True}
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {'_invalidJson': True}


def docker_json(arguments):
    result = subprocess.run(['/usr/bin/docker', *arguments], check=True, capture_output=True, timeout=30)
    if len(result.stdout) > 2 * 1024 * 1024:
        raise RuntimeError('photo_disk_inventory_too_large')
    return json.loads(result.stdout)


# Production getJsonStorage() uses ObjectJsonStorage, not the read-only data
# mounts. Match data.ts's prefix/bucket/key and SigV4 GET without loading app
# modules or creating files. Credentials stay inside the serving container.
AJ_FAILURE_READER = r"""
import {createHash,createHmac} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const hmac=(key,value)=>createHmac('sha256',key).update(value).digest();
const keys=[...Array.from({length:8},(_,i)=>['stats-list-'+(i+1),'integrations/ajes/catalog-failure-pages/stats-list-'+(i+1)+'.json']),
 ['stats-latest','integrations/ajes/catalog-failure-stats.json']];
const int=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max?x:null;
const timestamp=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x)&&Number.isFinite(Date.parse(x))?x:null;
const outcomes=/^(?:http_[1-5]\d{2}|visitor_restricted|request_failed|request_timeout|connect_timeout|quota_exhausted|quota_busy|local_busy|invalid_response|empty_response|query_too_large|response_too_large|identity_mismatch)$/;
const sanitize=value=>({startedAt:timestamp(value?.startedAt),finishedAt:timestamp(value?.finishedAt),
 kind:['list','detail','count','models','makes','colors'].includes(value?.kind)?value.kind:null,
 outcome:typeof value?.outcome==='string'&&outcomes.test(value.outcome)?value.outcome:null,
 page:int(value?.page,1,1000000),pageSize:int(value?.pageSize,1,500),httpStatus:int(value?.httpStatus,100,599),
 providerCode:typeof value?.providerCode==='string'&&/^(?:bot|ban)\d{0,13}$/.test(value.providerCode)?value.providerCode:null,
 sqlSha256:typeof value?.sql==='string'?hash(value.sql):null,sqlBytes:typeof value?.sql==='string'?Buffer.byteLength(value.sql):null});
let total=0;
const records=[];
try {
 const env=process.env;
 if(env.JSON_STORAGE_DRIVER!=='object')throw Error();
 const endpoint=new URL(env.YC_OBJECT_STORAGE_ENDPOINT||'https://storage.yandexcloud.net');
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw Error();
 const bucket=env.YC_OBJECT_STORAGE_BUCKET||'',access=env.YC_OBJECT_STORAGE_ACCESS_KEY_ID||'',secret=env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY||'';
 const region=env.YC_OBJECT_STORAGE_REGION||'ru-central1',prefix=(env.YC_OBJECT_STORAGE_PREFIX||'').replace(/^\/+|\/+$/g,'');
 if(!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)||!access||!secret||prefix.split('/').some(x=>x==='.'||x==='..'))throw Error();
 const signal=AbortSignal.timeout(20000);
 for(const [slot,key] of keys){
  if(signal.aborted){records.push({slot,readStatus:'deadline'});continue;}
  if(total>=256*1024){records.push({slot,readStatus:'byte_limit'});continue;}
  try {
   const full=[prefix,key].filter(Boolean).join('/').split('/').map(encodeURIComponent).join('/');
   const url=new URL(endpoint.href.replace(/\/+$/g,'')+'/'+bucket+'/'+full);
   if(url.origin!==endpoint.origin)throw Error();
   const date=new Date().toISOString().replace(/[:-]|\.\d{3}/g,''),day=date.slice(0,8),payload=hash('');
   const headers={host:url.host,'x-amz-content-sha256':payload,'x-amz-date':date};
   const signed=Object.keys(headers).sort().join(';');
   const canonical=Object.keys(headers).sort().map(k=>k+':'+headers[k].trim()+'\n').join('');
   const scope=day+'/'+region+'/s3/aws4_request';
   const toSign=['AWS4-HMAC-SHA256',date,scope,hash(['GET',url.pathname,'',canonical,signed,payload].join('\n'))].join('\n');
   const signing=hmac(hmac(hmac(hmac('AWS4'+secret,day),region),'s3'),'aws4_request');
   headers.authorization='AWS4-HMAC-SHA256 Credential='+access+'/'+scope+', SignedHeaders='+signed+', Signature='+createHmac('sha256',signing).update(toSign).digest('hex');
   const response=await fetch(url,{method:'GET',headers,redirect:'error',signal});
   if(response.status!==200){await response.body?.cancel();records.push({slot,readStatus:response.status===404?'missing':'unavailable'});continue;}
   const limit=Math.min(64*1024,256*1024-total);
   if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();records.push({slot,readStatus:'byte_limit'});continue;}
   const reader=response.body?.getReader();if(!reader)throw Error();
   const chunks=[];let bytes=0,oversize=false;
   while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;bytes+=value.byteLength;
    if(bytes>limit||total>256*1024){oversize=true;await reader.cancel();break;}chunks.push(value);}
   if(oversize){records.push({slot,readStatus:'byte_limit'});continue;}
   const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!value||typeof value!=='object'||Array.isArray(value))throw Error();
   records.push({slot,readStatus:'ok',...sanitize(value)});
  } catch {records.push({slot,readStatus:signal.aborted?'deadline':'unavailable'});}
 }
 process.stdout.write(JSON.stringify({records}));
} catch {process.stdout.write(JSON.stringify({readStatus:'configuration_unavailable',records:[]}));}
"""


def serving_signature(row, port, release):
    env = dict(item.split('=', 1) for item in row.get('Config', {}).get('Env', []) if '=' in item)
    ports = row.get('HostConfig', {}).get('PortBindings') or {}
    if (not row.get('State', {}).get('Running') or row.get('Config', {}).get('WorkingDir') != '/app'
            or env.get('AVTOCENA_RELEASE_SHA') != release or env.get('JSON_STORAGE_DRIVER') != 'object'
            or not any(str(binding.get('HostPort', '')) == str(port)
                       for bindings in ports.values() for binding in (bindings or []))):
        raise RuntimeError('photo_disk_ajes_serving')
    protected = {key: row.get(key) for key in ('Id', 'Image', 'Config', 'HostConfig')}
    protected['mounts'] = sorted(row.get('Mounts', []), key=lambda value: (value.get('Destination', ''), value.get('Source', '')))
    protected['startedAt'] = row['State'].get('StartedAt')
    return hashlib.sha256(json.dumps(protected, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def aj_failure_diagnostic(row, port, health, ingress):
    identity = row.get('Id', '')
    if not re.fullmatch(r'[a-f0-9]{64}', identity) or health.get('status') != 200 or health.get('ok') is not True:
        raise RuntimeError('photo_disk_ajes_serving')
    before = docker_json(['inspect', identity])[0]
    signature = serving_signature(before, port, health.get('releaseSha'))
    if CONFIG.read_bytes() != ingress:
        raise RuntimeError('photo_disk_ajes_ingress_changed')
    try:
        result = subprocess.run(['/usr/bin/docker', 'exec', '-i', '-e', 'NODE_OPTIONS=', identity,
                                 'node', '--input-type=module'], input=AJ_FAILURE_READER.encode(),
                                capture_output=True, timeout=30)
        if result.returncode != 0 or len(result.stdout) > 8192:
            raise ValueError()
        value = json.loads(result.stdout)
        if not isinstance(value, dict) or not isinstance(value.get('records'), list) or len(value['records']) > 9:
            raise ValueError()
    except (subprocess.TimeoutExpired, ValueError, UnicodeDecodeError):
        value = {'readStatus': 'reader_unavailable', 'records': []}
    after = docker_json(['inspect', identity])[0]
    if signature != serving_signature(after, port, health.get('releaseSha')) or CONFIG.read_bytes() != ingress:
        raise RuntimeError('photo_disk_ajes_serving_changed')
    con = http.client.HTTPConnection('127.0.0.1', port, timeout=15)
    try:
        con.request('GET', '/api/health', headers={'Host': 'avtocena.com', 'Connection': 'close'})
        response = con.getresponse()
        raw = response.read(65537)
        if response.status != 200 or len(raw) > 65536:
            raise RuntimeError('photo_disk_ajes_health_changed')
        observed = json.loads(raw)
        if (observed.get('ok') is not True or any(observed.get(key) != health.get(key)
                for key in ('releaseSha', 'calculationVersion')) or CONFIG.read_bytes() != ingress):
            raise RuntimeError('photo_disk_ajes_health_changed')
    finally:
        con.close()
    return {'servingBoundBeforeAfter': True, **value}


def bounded_snapshot(path, limit):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(descriptor)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or before.st_nlink != 1
                or before.st_mode & 0o022 or before.st_size > limit):
            raise ValueError()
        raw = os.read(descriptor, limit + 1)
        after = os.fstat(descriptor)
        fields = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
        if len(raw) != before.st_size or any(getattr(before, key) != getattr(after, key) for key in fields):
            raise ValueError()
        return raw, after
    finally:
        os.close(descriptor)


def bounded_bytes(path, limit):
    return bounded_snapshot(path, limit)[0]


def bounded_proof(path, limit):
    raw = bounded_bytes(path, limit)
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError()
    return value, hashlib.sha256(raw).hexdigest()


def failed_code_cleanup_diagnostic(directory, runtime):
    try:
        value, digest = bounded_proof(directory / 'FAILED_CODE_CLEANUP.json', 16 * 1024)
    except FileNotFoundError:
        return {'present': False}
    except (OSError, ValueError, UnicodeDecodeError):
        return {'present': True, 'valid': False}
    try:
        plan, plan_digest = bounded_proof(directory / 'PLAN.json', 256 * 1024)
        rollback, rollback_digest = bounded_proof(directory / 'ROLLED_BACK.json', 256 * 1024)
        numbers = ('filesDeleted', 'logicalBytesDeleted', 'imagesDeleted', 'directoriesDeleted')
        valid = (value.get('version') == 1 and value.get('kind') == 'china-failed-code-bulk-cleanup-v1'
                 and all(type(value.get(key)) is int and 0 <= value[key] <= 9007199254740991 for key in numbers)
                 and type(value.get('completed')) is bool and type(value.get('protectedDeploymentsPreserved')) is bool)
        if not valid:
            return {'present': True, 'valid': False, 'receiptSha256': digest}
        return {'present': True, 'valid': True, 'receiptSha256': digest,
                **{key: value[key] for key in (*numbers, 'completed', 'protectedDeploymentsPreserved')},
                'bindsAttempt': value.get('nonce') == directory.name == plan.get('nonce') == rollback.get('nonce')
                    and runtime in (RUNTIMES[0], RUNTIMES[3])
                    and value.get('runtimeSha') == runtime == plan.get('runtimeSha') == rollback.get('release'),
                'bindsPlan': value.get('planSha256') == plan_digest,
                'bindsRollback': value.get('rollbackSha256') == rollback_digest}
    except (OSError, ValueError, UnicodeDecodeError):
        return {'present': True, 'valid': False, 'receiptSha256': digest}


def speed_need(condition, _reason):
    if not condition:
        raise ValueError()


def saved_speed_sample(row, paths):
    """The fixed public-field allowlist from release-host.py; never emit raw logs."""
    speed_need(isinstance(row, dict), 'diagnosis_speed_sample')
    phases = {'warm', 'after_ttl', 'after_directory_ttl'}
    def numbers(names):
        speed_need(all(type(row.get(name)) in (int, float) and math.isfinite(row[name]) and 0 <= row[name] <= 86400
                 for name in names), 'diagnosis_speed_number')
        return {name: row[name] for name in names}
    def booleans(names):
        speed_need(all(type(row.get(name)) is bool for name in names), 'diagnosis_speed_boolean')
        return {name: row[name] for name in names}
    if row.get('performanceGate') == 'summary':
        speed_need(row.get('marketScope') == 'china' and
             all(isinstance(row.get(name), list) and len(row[name]) <= 64 and all(path in paths for path in row[name])
                 for name in ('routes', 'acceptedBaselineRoutes')) and
             all(type(row.get(name)) is int and 0 <= row[name] <= 10000 for name in ('samples', 'slowSamples')),
             'diagnosis_speed_summary')
        return {'performanceGate': 'summary', 'marketScope': 'china', 'routes': list(row['routes']),
                'acceptedBaselineRoutes': list(row['acceptedBaselineRoutes']), 'samples': row['samples'], 'slowSamples': row['slowSamples'],
                **booleans(('functionalPassed', 'performanceAccepted', 'latencyBlocking', 'acceptedBaselineEnforced'))}
    speed_need(isinstance(row.get('path'), str) and row['path'] in paths, 'diagnosis_speed_route')
    route = {'path': row['path']}
    if row.get('performanceRequest') in {'started', 'complete', 'failed'}:
        result = {**route, 'performanceRequest': row['performanceRequest']}
        if row['performanceRequest'] != 'started':
            result.update(numbers(('seconds',)))
        if row['performanceRequest'] == 'complete':
            result.update(booleans(('functionalPassed',)))
        if row['performanceRequest'] == 'failed':
            errors = {'AssertionError', 'HTTPError', 'URLError', 'TimeoutError', 'JSONDecodeError', 'RemoteDisconnected',
                      'IncompleteRead', 'ConnectionResetError', 'ConnectionRefusedError', 'ValueError', 'KeyError', 'TypeError',
                      'OSError', 'SSLError', 'UnicodeDecodeError'}
            result['errorType'] = row.get('errorType') if row.get('errorType') in errors else 'other'
        return result
    if row.get('speedBaseline') in phases:
        result = {**route, 'speedBaseline': row['speedBaseline'],
                  **numbers(('referenceSeconds', 'measurementNoiseSeconds', 'ceilingSeconds', 'seconds')),
                  **booleans(('blocking', 'passed'))}
        if 'recheckSeconds' in row or 'recheckMedianSeconds' in row:
            values = row.get('recheckSeconds')
            speed_need(isinstance(values, list) and len(values) == 3 and
                 all(type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 86400 for value in values),
                 'diagnosis_speed_recheck')
            result.update(recheckSeconds=list(values), **numbers(('recheckMedianSeconds',)))
        return result
    if row.get('performanceGate') in phases:
        return {**route, 'performanceGate': row['performanceGate'], **numbers(('seconds', 'ceiling')),
                **booleans(('passed', 'functionalPassed', 'latencyBlocking'))}
    raise ValueError()


def saved_speed_diagnosis(directory, runtime):
    """Read only the saved b6/36/genB result, bound to its copied gate and baseline."""
    selected = False
    stage = 'plan_binding'
    try:
        plan, plan_digest = bounded_proof(directory / 'PLAN.json', 256 * 1024)
        selected = runtime == PHOTO_SPEED_PLAN['runtimeSha'] and all(
            plan.get(key) == value for key, value in PHOTO_SPEED_PLAN.items())
        if not selected:
            return {'selected': False}
        speed_need(re.fullmatch(r'[a-f0-9]{32}', directory.name) and plan.get('nonce') == directory.name
                   and directory.parent.name == 'china-next' and directory.parent.parent.name == runtime,
                   'diagnosis_speed_attempt')
        stage = 'report_file'
        try:
            raw = bounded_bytes(directory / 'server-speed-result.json', 256 * 1024)
        except FileNotFoundError:
            return {'selected': True, 'valid': True, 'present': False, 'planSha256': plan_digest,
                    'sha256': None, 'exitCode': None, 'samples': [], 'rejectedSamples': 0}
        stage = 'source_binding'
        speed_need(isinstance(plan.get('files'), list) and len(plan['files']) <= 64, 'diagnosis_speed_sources')
        baseline = None
        for name, pinned_digest in PHOTO_SPEED_SOURCES.items():
            matches = [row for row in plan['files'] if isinstance(row, dict) and row.get('name') == name]
            speed_need(len(matches) == 1, 'diagnosis_speed_source')
            expected = matches[0]
            source = bounded_bytes(directory / name, 256 * 1024)
            speed_need(type(expected.get('bytes')) is int and len(source) == expected['bytes']
                       and hashlib.sha256(source).hexdigest() == expected.get('sha256') == pinned_digest,
                       'diagnosis_speed_source')
            if name == 'accepted-speed-baseline.json':
                baseline = json.loads(source)
        paths = {row['path'] for row in baseline['samples']}
        paths.add('/cars?market=china')
        stage = 'report_shape'
        value = json.loads(raw)
        speed_need(isinstance(value, dict) and set(value) == {'exitCode', 'samples'}
                   and type(value.get('exitCode')) is int and -255 <= value['exitCode'] <= 255
                   and isinstance(value.get('samples'), list) and len(value['samples']) <= 512,
                   'diagnosis_speed_report')
        samples = []
        rejected = 0
        for row in value['samples']:
            try:
                samples.append(saved_speed_sample(row, paths))
            except (TypeError, ValueError, OverflowError):
                rejected += 1
        return {'selected': True, 'valid': True, 'present': True, 'planSha256': plan_digest,
                'sourceSha256': dict(PHOTO_SPEED_SOURCES), 'sha256': hashlib.sha256(raw).hexdigest(),
                'exitCode': value['exitCode'], 'samples': samples, 'rejectedSamples': rejected}
    except (OSError, ValueError, TypeError, KeyError, OverflowError):
        return {'selected': selected, 'valid': False, 'reason': stage}


def photo_need(condition, reason):
    if not condition:
        raise RuntimeError('photo_disk_photo_' + reason)


def photo_directory(directory):
    descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(descriptor)
        photo_need(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022
                   and directory.resolve() == directory, 'directory')
    finally:
        os.close(descriptor)


def photo_health(ingress):
    found = re.findall(rb'(?m)^\s*proxy_pass http://127\.0\.0\.1:(\d+);\s*$', ingress)
    photo_need(len(found) == 1 and 1 <= int(found[0]) <= 65535, 'ingress')
    connection = http.client.HTTPConnection('127.0.0.1', int(found[0]), timeout=15)
    try:
        connection.request('GET', '/api/health', headers={'Host': 'avtocena.com', 'Connection': 'close'})
        response = connection.getresponse()
        raw = response.read(100001)
        photo_need(response.status == 200 and len(raw) <= 100000, 'health')
        value = json.loads(raw)
        photo_need(isinstance(value, dict) and value.get('ok') is True
                   and value.get('releaseSha') == RUNTIMES[1]
                   and value.get('calculationVersion') == PHOTO_CALCULATION, 'health')
        return {'status': 200, 'ok': True, 'releaseSha': value['releaseSha'],
                'calculationVersion': value['calculationVersion']}
    finally:
        connection.close()


def photo_saved_observation(directory, name, plan):
    """Existing startup/home schemas, with the verified nonce omitted from output."""
    try:
        value, digest = bounded_proof(directory / name, 256 * 1024)
    except FileNotFoundError:
        return {'present': False}
    except (OSError, ValueError, RecursionError):
        return {'present': True, 'valid': False}
    try:
        natural = lambda number: type(number) is int and 0 <= number <= 9007199254740991
        number = lambda value, maximum: type(value) in (int, float) and math.isfinite(value) and 0 <= value <= maximum
        if name == 'STARTUP.json':
            keys = {'version', 'kind', 'ready', 'elapsedSeconds', 'attempts', 'health', 'candidate', 'reason'}
            speed_need(set(value) == keys and type(value['version']) is int and value['version'] == 1
                       and value['kind'] == 'china-host-startup-v1' and type(value['ready']) is bool
                       and number(value['elapsedSeconds'], 3600) and natural(value['attempts']) and value['attempts'] <= 10000
                       and value['health'] in {'not_checked', 'ok', 'connection_refused', 'timeout', 'invalid_json',
                           'identity_mismatch', 'http_response', 'connection_error', 'unavailable'}
                       and value['reason'] in {'ready', 'timeout', 'exited', 'oom', 'restarted', 'inspect_unavailable'}
                       and value['ready'] == (value['reason'] == 'ready') and (not value['ready'] or value['health'] == 'ok'),
                       'startup')
            candidate = value['candidate']
            speed_need(candidate is None or (isinstance(candidate, dict)
                       and set(candidate) == {'running', 'status', 'exitCode', 'oomKilled', 'restartCount'}
                       and type(candidate['running']) is bool and type(candidate['oomKilled']) is bool
                       and type(candidate['exitCode']) is int and abs(candidate['exitCode']) <= 2147483647
                       and natural(candidate['restartCount']) and candidate['restartCount'] <= 10000
                       and candidate['status'] in {'created', 'restarting', 'running', 'removing', 'paused', 'exited', 'dead'}), 'startup')
            clean = value
        else:
            speed_need(name == 'HOME_PHASE_TIMING.json', 'observation')
            keys = {'version', 'kind', 'runtimeSha', 'nonce', 'logBytes', 'logLines', 'rejectedRows', 'limited', 'rows'}
            speed_need(set(value) == keys and type(value['version']) is int and value['version'] == 1
                       and value['kind'] == 'china-home-phase-timing-v1' and value['runtimeSha'] == plan['runtimeSha']
                       and value['nonce'] == plan['nonce'] and natural(value['logBytes']) and value['logBytes'] <= 512 * 1024
                       and natural(value['logLines']) and value['logLines'] <= 2048 and natural(value['rejectedRows'])
                       and type(value['limited']) is bool and isinstance(value['rows'], list) and len(value['rows']) <= 512
                       and len(value['rows']) + value['rejectedRows'] <= value['logLines'], 'home_timing')
            phases = {'dealer', 'snapshot', 'counts', 'green', 'greenPricing', 'catalogPricing', 'dealerRail', 'japanRail',
                      'snapshotContext', 'snapshotBody', 'snapshotPrepared', 'snapshotManifest', 'snapshotOverview',
                      'snapshotProjection', 'snapshotEditorialPrepared'} | {
                          'snapshotEditorial:' + market for market in ('china', 'japan', 'korea', 'uae', 'europe', 'georgia')}
            for row in value['rows']:
                speed_need(isinstance(row, dict), 'home_row')
                row_keys = {'trace', 'phase', 'ms', 'ok', 'policyDate', 'completedPolicyDate'}
                if 'generation' in row:
                    row_keys.add('generation')
                    speed_need(isinstance(row['generation'], str)
                               and re.fullmatch(r'gen_[0-9]{1,20}_[a-z0-9-]{1,80}', row['generation']), 'home_generation')
                speed_need(set(row) == row_keys and isinstance(row['trace'], str)
                           and re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', row['trace'])
                           and row['phase'] in phases and number(row['ms'], 86400000) and type(row['ok']) is bool, 'home_row')
                for key in ('policyDate', 'completedPolicyDate'):
                    speed_need(isinstance(row[key], str) and re.fullmatch(r'\d{4}-\d\d-\d\d', row[key])
                               and datetime.date.fromisoformat(row[key]).isoformat() == row[key], 'home_date')
            clean = {key: entry for key, entry in value.items() if key != 'nonce'}
        return {'present': True, 'valid': True, 'sha256': digest, 'value': clean}
    except (ValueError, TypeError, KeyError, OverflowError):
        return {'present': True, 'valid': False, 'sha256': digest}


class PhotoDocker(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(15)
        self.sock.connect('/var/run/docker.sock')


def photo_events(plan, since, until):
    """The release-host event allowlist, scoped to this failed attempt only."""
    actions = {'create', 'start', 'die', 'oom', 'stop', 'kill', 'destroy', 'restart'}
    filters = {'type': ['container'], 'label': ['avtocena.china.nonce=' + plan['nonce'],
               'org.opencontainers.image.revision=' + plan['runtimeSha']], 'event': sorted(actions)}
    connection = PhotoDocker('localhost', timeout=15)
    try:
        photo_need(type(since) is int and type(until) is int and 0 < until - since <= 300
                   and until <= int(time.time()), 'event_window')
        target = '/events?' + urlencode({'since': since, 'until': until, 'filters': json.dumps(filters)})
        connection.request('GET', target)
        response = connection.getresponse()
        raw = response.read(1024 * 1024 + 1)
        speed_need(response.status == 200 and len(raw) <= 1024 * 1024, 'events_response')
        rows = []
        candidate_ids = set()
        for line in raw.splitlines():
            value = json.loads(line)
            attributes = value.get('Actor', {}).get('Attributes', {})
            action, when = value.get('Action'), value.get('time')
            speed_need(value.get('Type') == 'container' and action in actions and type(when) is int and since <= when <= until
                       and attributes.get('avtocena.china.nonce') == plan['nonce']
                       and attributes.get('org.opencontainers.image.revision') == plan['runtimeSha'], 'event_scope')
            candidate_id = value.get('Actor', {}).get('ID')
            speed_need(isinstance(candidate_id, str) and re.fullmatch(r'[a-f0-9]{64}', candidate_id), 'event_identity')
            candidate_ids.add(candidate_id)
            speed_need(len(candidate_ids) == 1, 'event_identity')
            exit_code = attributes.get('exitCode')
            speed_need(exit_code is None or isinstance(exit_code, str) and re.fullmatch(r'-?\d{1,8}', exit_code), 'event_exit')
            row = {'action': action, 'time': when, 'exitCode': int(exit_code) if exit_code is not None else None,
                   'oom': action == 'oom'}
            if 'timeNano' in value:
                nano = value['timeNano']
                speed_need(type(nano) is int and when * 1_000_000_000 <= nano < (when + 1) * 1_000_000_000,
                           'event_nanoseconds')
                # Docker emits an integer beyond JavaScript's safe range.
                # Keep all digits through JSON and downstream comparisons.
                row['timeNano'] = str(nano)
            rows.append(row)
            speed_need(len(rows) <= 512, 'event_count')
        return {'available': True, 'reason': None if rows else 'empty', 'rows': rows}, next(iter(candidate_ids), None)
    except Exception:
        return {'available': False, 'reason': 'unavailable', 'rows': []}, None
    finally:
        connection.close()


def photo_retained_launch(rollback, ingress, health):
    """Current retained configuration is reconstruction evidence, not an old snapshot."""
    identity = rollback.get('retainedContainerId')
    photo_need(isinstance(identity, str) and re.fullmatch(r'[a-f0-9]{64}', identity), 'retained_identity')
    connection = PhotoDocker('localhost', timeout=15)
    try:
        connection.request('GET', '/containers/' + identity + '/json')
        response = connection.getresponse()
        raw = response.read(512 * 1024 + 1)
        photo_need(response.status == 200 and len(raw) <= 512 * 1024, 'retained_response')
        value = json.loads(raw)
    finally:
        connection.close()
    config, state = value.get('Config', {}), value.get('State', {})
    entries = config.get('Env')
    photo_need(isinstance(entries, list) and len(entries) <= 512
               and all(isinstance(entry, str) and '=' in entry and len(entry) <= 16384 for entry in entries), 'retained_environment')
    names = ['AVTOCENA_RELEASE_SHA', 'NEXT_MANUAL_SIG_HANDLE', 'NEXT_CPU_PROF', '__NEXT_PRIVATE_CPU_PROFILE', 'NODE_OPTIONS']
    selected = {name: [entry.split('=', 1)[1] for entry in entries if entry.split('=', 1)[0] == name] for name in names}
    photo_need(all(len(values) <= 1 for values in selected.values()), 'retained_environment')
    env = {name: values[0] for name, values in selected.items() if values}
    port = re.findall(rb'(?m)^\s*proxy_pass http://127\.0\.0\.1:(\d+);\s*$', ingress)
    photo_need(len(port) == 1 and value.get('Id') == identity and value.get('Image') == rollback.get('retainedImageId')
               and state.get('Running') is True and type(state.get('Pid')) is int and 0 < state['Pid'] <= 2147483647
               and isinstance(state.get('StartedAt'), str) and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z', state['StartedAt'])
               and env.get('AVTOCENA_RELEASE_SHA') == health['releaseSha'] == RUNTIMES[1]
               and any(str(binding.get('HostPort', '')) == port[0].decode()
                       for bindings in (value.get('HostConfig', {}).get('PortBindings') or {}).values()
                       for binding in (bindings or [])), 'retained_binding')
    entrypoint, command = config.get('Entrypoint'), config.get('Cmd')
    photo_need(all(args is None or isinstance(args, list) and len(args) <= 64
                   and all(isinstance(arg, str) and len(arg) <= 8192 for arg in args) for args in (entrypoint, command)), 'retained_argv')
    safe_entry = entrypoint in (None, [], ['docker-entrypoint.sh'], ['/usr/local/bin/docker-entrypoint.sh'])
    safe_command = command in (['node', 'apps/web/server.js'], ['node', '/app/apps/web/server.js'])
    first = [Path(args[0]).name for args in (entrypoint, command) if args]
    argv_class = 'node_standalone' if safe_entry and safe_command else 'shell_wrapper' if any(
        arg in {'sh', 'bash', 'ash', 'dash'} for arg in first) else 'package_manager_wrapper' if any(
        arg in {'npm', 'npx', 'yarn', 'pnpm'} for arg in first) else 'node_other' if 'node' in first else 'other'
    digest = lambda args: hashlib.sha256(json.dumps(args, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
    options = {'present': 'NODE_OPTIONS' in env, 'parseSucceeded': True, 'preloadPresent': False}
    try:
        tokens = shlex.split(env.get('NODE_OPTIONS', ''))
        options['preloadPresent'] = any(token in {'-r', '--require', '--import', '--loader', '--experimental-loader'}
            or token.startswith(('--require=', '--import=', '--loader=', '--experimental-loader='))
            or token.startswith('-r') and not token.startswith('--') and len(token) > 2 for token in tokens)
    except ValueError:
        options.update(parseSucceeded=False, preloadPresent=None)
    summary = {'evidenceKind': 'current_retained_reconstruction', 'historicalCandidateSnapshot': False,
               'argvClass': argv_class, 'matchesExpectedStandalone': safe_entry and safe_command,
               'entrypointSha256': digest(entrypoint), 'cmdSha256': digest(command),
               'environmentFlags': {name: {'present': name in env, 'truthy': bool(env.get(name, ''))}
                   for name in ('NEXT_MANUAL_SIG_HANDLE', 'NEXT_CPU_PROF', '__NEXT_PRIVATE_CPU_PROFILE')},
               'nodeOptions': options}
    if safe_entry and safe_command:
        summary['knownSafeArgv'] = {'entrypoint': entrypoint, 'cmd': command}
    return summary, (identity, value['Image'], state['Pid'], state['StartedAt'])


def photo_journal_rows(raw, candidate_id, source, since, until):
    """Count fixed observations only; matchedLines means bound, in-window rows.

    unclassifiedLines is a subset of matchedLines. One line can contain both a
    homepage marker and a fixed storage code, so category counts may overlap.
    """
    if (type(raw) is not bytes or type(candidate_id) is not str
            or re.fullmatch(r'[a-f0-9]{64}', candidate_id) is None
            or source not in ('container', 'services')
            or type(since) is not int or type(until) is not int
            or not 0 <= since < until or until - since > 300):
        raise ValueError('photo_journal_arguments')
    lines = raw.splitlines()
    if len(lines) > 2048:
        raise ValueError('photo_journal_line_limit')
    result = {'linesRead': len(lines), 'matchedLines': 0, 'rejectedLines': 0,
              'unclassifiedLines': 0, 'categories': {}, 'taskExits': []}
    home = {'home_specials_failed', 'home_dealer_failed', 'home_initial_catalog_failed',
            'home_green_pricing_unavailable', 'home_initial_pricing_failed'}
    aj_reasons = {'client_ip_missing', 'not_configured', 'invalid_response', 'visitor_restricted',
                  'request_failed', 'request_timeout', 'connect_timeout', 'response_too_large',
                  'empty_response', 'identity_mismatch', 'quota_invalid', 'quota_exhausted',
                  'quota_busy', 'local_busy', 'query_too_large', 'operation_failed'}
    storage = {'object_storage_response_timeout', 'object_storage_read_deadline',
               'object_storage_response_limit'}
    stream = {'failed to pipe response': 'next_pipe_response_failed',
              'failed to write chunk to response': 'next_write_chunk_failed'}
    shim = {'shim disconnected': 'containerd_shim_disconnected',
            'cleaning up after shim disconnected': 'containerd_shim_cleanup',
            'failed to clean up after shim disconnected': 'containerd_shim_cleanup_failed'}
    full_id = re.compile(r'(?<![a-fA-F0-9])' + candidate_id + r'(?![a-fA-F0-9])')

    def unique(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError('photo_journal_duplicate_key')
            value[key] = item
        return value

    def parsed_json(value):
        return json.loads(value, object_pairs_hook=unique)

    def service_fields(message, payload):
        if isinstance(payload, dict):
            return payload
        fields = {}
        # Consume each complete logfmt value, including quoted private errors;
        # never reinterpret an id= fragment inside a quoted error as a field.
        pattern = re.compile(r'([A-Za-z][A-Za-z0-9_-]*)=("(?:\\.|[^"\\])*"|[^"\s]+)')
        position = 0
        while position < len(message):
            while position < len(message) and message[position] in ' \t':
                position += 1
            if position == len(message):
                break
            match = pattern.match(message, position)
            if match is None or match.end() < len(message) and message[match.end()] not in ' \t':
                raise ValueError('photo_journal_logfmt')
            position = match.end()
            key, value = match.groups()
            if key not in ('msg', 'id', 'container', 'container_id', 'topic', 'type'):
                continue
            if key in fields:
                raise ValueError('photo_journal_duplicate_field')
            fields[key] = parsed_json(value) if value.startswith('"') else value
        return fields

    for line in lines:
        try:
            entry = parsed_json(line)
            if not isinstance(entry, dict):
                raise ValueError('photo_journal_row')
            stamp, message = entry.get('__REALTIME_TIMESTAMP'), entry.get('MESSAGE')
            if (type(stamp) is not str or re.fullmatch(r'[0-9]{1,20}', stamp) is None
                    or not since * 1_000_000 <= int(stamp) <= until * 1_000_000
                    or type(message) is not str or len(message.encode('utf8')) > 16 * 1024):
                raise ValueError('photo_journal_row')
            if source == 'container':
                if entry.get('CONTAINER_ID_FULL') != candidate_id:
                    raise ValueError('photo_journal_identity')
            elif (entry.get('_SYSTEMD_UNIT') not in ('docker.service', 'containerd.service')
                    or full_id.search(message) is None):
                raise ValueError('photo_journal_identity')
        except (ValueError, TypeError, UnicodeError, OverflowError, RecursionError):
            result['rejectedLines'] += 1
            continue
        result['matchedLines'] += 1
        categories = set()
        if source == 'container':
            # Only terminal colour escapes are removed. Never output the line.
            clean = re.sub(r'\x1b\[[0-9;]*m', '', message)
            for marker in home:
                if re.match(re.escape(marker) + r'(?:[ \t]|$)', clean):
                    categories.add(marker)
            aj = re.fullmatch(r'AJES_PUBLIC_FAILURE[ \t]+([a-z_]+)[ \t]*', clean)
            if aj and aj.group(1) in aj_reasons:
                categories.add('ajes_public_failure_' + aj.group(1))
            # Known storage messages may be nested in a homepage catch message.
            # Stop at the fixed code: paths, URLs and error tails are discarded.
            prefix = (r'^[ \t]*(?:(?:' + '|'.join(sorted(home))
                      + r')[ \t]+)?(?:⨯[ \t]*)?(?:\[cause\]:[ \t]*)?(?:Error:[ \t]*)?')
            for code in storage:
                if re.match(prefix + r'(?:object_storage_(?:GET|HEAD)_unreachable:)?'
                            + re.escape(code) + r'(?::|[ \t]|$)', clean):
                    categories.add(code)
            for message_text, code in stream.items():
                if re.match(prefix + re.escape(message_text) + r'(?:[ \t]*\{|[ \t]*$)', clean):
                    categories.add(code)
        else:
            payload = None
            try:
                if message.lstrip().startswith('{'):
                    payload = parsed_json(message)
                fields = service_fields(message, payload)
                if fields.get('id') == candidate_id and fields.get('msg') in shim:
                    categories.add(shim[fields['msg']])
                if (fields.get('container') == candidate_id and fields.get('msg') == 'received task-delete event from containerd'
                        and fields.get('topic') == '/tasks/delete'
                        and fields.get('type') in ('*events.TaskDelete', 'containerd.events.TaskDelete')):
                    categories.add('containerd_task_delete')
                # A type name in a logfmt message is not a TaskExit payload.
                event = payload.get('event') if isinstance(payload, dict) else None
                if (isinstance(payload, dict) and payload.get('topic') == '/tasks/exit'
                        and isinstance(event, dict) and event.get('container_id') == candidate_id
                        and event.get('id') == candidate_id):
                    pid, status = event.get('pid'), event.get('exit_status')
                    hints = [payload[key] for key in ('type', '@type') if key in payload]
                    hints += [event[key] for key in ('type', '@type') if key in event]
                    if (all(hint in ('TaskExit', '*events.TaskExit', 'containerd.events.TaskExit') for hint in hints)
                            and type(pid) is int and 1 <= pid <= 4294967295
                            and type(status) is int and 0 <= status <= 4294967295):
                        categories.add('containerd_task_exit')
                        result['taskExits'].append({'timeMicroseconds': str(int(stamp)), 'pid': pid, 'status': status,
                            'initTaskIdMatchesCandidate': True, 'pidSource': 'task_exit_payload'})
            except (ValueError, TypeError, UnicodeError, OverflowError, RecursionError):
                categories.clear()
        if not categories:
            result['unclassifiedLines'] += 1
        for category in categories:
            result['categories'][category] = result['categories'].get(category, 0) + 1
    return result


def photo_journal_capture(arguments, maximum, deadline):
    """Bound the diagnostic child itself; never invoke a shell or print stderr."""
    process = None
    raw = bytearray()
    reason = None
    try:
        process = subprocess.Popen(['/usr/bin/journalctl', *arguments], stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                reason = 'timeout'
                break
            readable, _, _ = select.select([process.stdout], [], [], remaining)
            if not readable:
                reason = 'timeout'
                break
            chunk = os.read(process.stdout.fileno(), min(16384, maximum + 1 - len(raw)))
            if not chunk:
                break
            raw.extend(chunk)
            if len(raw) > maximum:
                reason = 'byte_limit'
                break
        if reason is not None:
            process.kill()
        code = process.wait(timeout=max(0.05, min(1, deadline - time.monotonic())))
        return bytes(raw[:maximum]), {'available': code == 0 and reason is None, 'reason': reason or (None if code == 0 else 'unavailable')}
    except Exception:
        return b'', {'available': False, 'reason': 'unavailable'}
    finally:
        if process is not None:
            if process.poll() is None:
                process.kill()
                try:
                    process.wait(timeout=0.2)
                except subprocess.TimeoutExpired:
                    pass
            process.stdout.close()


def photo_journals(candidate_id, since, until):
    if candidate_id is None:
        return {'status': 'candidate_identity_unavailable', 'causeDetermined': False, 'sources': {}}
    photo_need(re.fullmatch(r'[a-f0-9]{64}', candidate_id) and 0 < until - since <= 300, 'journal_binding')
    utc = lambda stamp: datetime.datetime.fromtimestamp(stamp, datetime.timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
    common = ['--no-pager', '--output=json', '--output-fields=MESSAGE,__REALTIME_TIMESTAMP,CONTAINER_ID_FULL,_SYSTEMD_UNIT',
              '--since=' + utc(since), '--until=' + utc(until), '--lines=2048']
    queries = {'container': ['CONTAINER_ID_FULL=' + candidate_id],
               'services': ['--unit=docker.service', '--unit=containerd.service', '--grep=' + candidate_id]}
    remaining_bytes, remaining_lines = 512 * 1024, 2048
    deadline = time.monotonic() + 15
    sources = {}
    for source, query in queries.items():
        if remaining_bytes <= 0 or remaining_lines <= 0 or time.monotonic() >= deadline:
            sources[source] = {'available': False, 'reason': 'capture_limit'}
            continue
        raw, capture = photo_journal_capture([*common, *query], remaining_bytes, deadline)
        parts = raw.splitlines(keepends=True)
        bounded = b''.join(parts[:remaining_lines])
        limited = len(parts) >= remaining_lines or capture['reason'] in {'timeout', 'byte_limit'}
        remaining_bytes -= len(raw)
        remaining_lines -= min(len(parts), remaining_lines)
        observation = photo_journal_rows(bounded, candidate_id, source, since, until)
        sources[source] = {**capture, 'bytesRead': len(raw), 'limited': limited, **observation}
    recognized = any(value.get('categories') or value.get('taskExits') for value in sources.values())
    return {'status': 'recognized_observations' if recognized else 'no_retained_failure_evidence',
            'causeDetermined': False, 'sources': sources}


def photo_attempt_only():
    """One known failed attempt. No inventory, application gate or storage/provider reads."""
    global PHASE, REPORT
    report = {'kind': 'photo-release-attempt-readonly-v1'}
    REPORT = report
    PHASE = 'photo_lock'
    descriptor = os.open(PHOTO_LOCK, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            report.update(status='skipped_runtime_busy', runtimeLockBusy=True)
            print(json.dumps(report, separators=(',', ':')))
            return
        report['runtimeLockBusy'] = False
        PHASE = 'photo_health_before'
        ingress = bounded_bytes(CONFIG, 1024 * 1024)
        before_health = photo_health(ingress)
        PHASE = 'photo_attempt_binding'
        parent = BASE / RUNTIMES[3] / 'china-next'
        for directory in (BASE, parent.parent, parent):
            photo_directory(directory)
        children = list(parent.iterdir())
        photo_need(len(children) <= 200, 'directory_bound')
        attempts = [directory for directory in children if re.fullmatch(r'[a-f0-9]{32}', directory.name)]
        photo_need(len(attempts) <= 40, 'attempt_bound')
        matches = []
        for directory in attempts:
            photo_directory(directory)
            try:
                plan, digest = bounded_proof(directory / 'PLAN.json', 256 * 1024)
            except FileNotFoundError:
                continue
            if digest == PHOTO_ATTEMPT_PROOFS['PLAN.json']:
                matches.append((directory, plan))
        photo_need(len(matches) == 1, 'unique_attempt')
        directory, plan = matches[0]
        photo_need(plan.get('nonce') == directory.name and all(plan.get(key) == value for key, value in PHOTO_SPEED_PLAN.items()), 'plan_binding')
        snapshots = {}
        for name, digest in PHOTO_ATTEMPT_PROOFS.items():
            raw, info = bounded_snapshot(directory / name, 256 * 1024)
            photo_need(hashlib.sha256(raw).hexdigest() == digest, 'proof_hash')
            snapshots[name] = (raw, info)
        rollback = json.loads(snapshots['ROLLED_BACK.json'][0])
        photo_need(rollback.get('kind') == 'china-host-rollback-v1' and rollback.get('nonce') == plan['nonce']
                   and rollback.get('release') == plan['runtimeSha'] and rollback.get('generationManifestSha256') == plan['generationManifestSha256']
                   and rollback.get('retainedRuntimeSha') == RUNTIMES[1]
                   and all(rollback.get(key) is True for key in ('retainedRunning', 'candidateRemoved', 'ingressRestored')), 'rollback_binding')
        speed = saved_speed_diagnosis(directory, RUNTIMES[3])
        photo_need(speed.get('selected') and speed.get('valid') and speed.get('present') and speed.get('exitCode') == 1
                   and speed.get('sha256') == PHOTO_ATTEMPT_PROOFS['server-speed-result.json']
                   and speed.get('planSha256') == PHOTO_ATTEMPT_PROOFS['PLAN.json'], 'speed_binding')
        speed_written_ns = snapshots['server-speed-result.json'][1].st_mtime_ns
        speed_written = speed_written_ns / 1_000_000_000
        rolled_back_at = rollback.get('rolledBackAt')
        photo_need(isinstance(rolled_back_at, str) and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z', rolled_back_at), 'rollback_time')
        rollback_time = datetime.datetime.fromisoformat(rolled_back_at.replace('Z', '+00:00')).timestamp()
        # The failed request ran for 31 seconds. Include the preceding minute
        # and at most four minutes after the saved result.
        photo_need(datetime.datetime(2026, 11, 25, 19, 39, tzinfo=datetime.timezone.utc).timestamp() <= speed_written <= rollback_time
                   <= datetime.datetime(2026, 11, 25, 19, 51, tzinfo=datetime.timezone.utc).timestamp(), 'attempt_time')
        since = int(speed_written) - 60
        until = min(int(speed_written) + 240, int(rollback_time) + 2)
        PHASE = 'photo_retained_reconstruction'
        launch, retained_identity = photo_retained_launch(rollback, ingress, before_health)
        PHASE = 'photo_saved_observations'
        startup = photo_saved_observation(directory, 'STARTUP.json', plan)
        timing = photo_saved_observation(directory, 'HOME_PHASE_TIMING.json', plan)
        PHASE = 'photo_events'
        events, candidate_id = photo_events(plan, since, until)
        PHASE = 'photo_journal'
        journal = photo_journals(candidate_id, since, until)
        PHASE = 'photo_health_after'
        photo_need(bounded_bytes(CONFIG, 1024 * 1024) == ingress and photo_health(ingress) == before_health, 'retained_changed')
        after_launch, after_identity = photo_retained_launch(rollback, ingress, before_health)
        photo_need(after_launch == launch and after_identity == retained_identity, 'retained_changed')
        for name, (raw, before) in snapshots.items():
            after_raw, after = bounded_snapshot(directory / name, 256 * 1024)
            photo_need(raw == after_raw and all(getattr(before, field) == getattr(after, field)
                       for field in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')), 'proof_changed')
        PHASE = 'photo_capacity'
        usage = os.statvfs('/')
        report.update(status='observed', runtimeSha=plan['runtimeSha'], controllerSha=plan['controllerSha'],
                      measuredAt=datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z'),
                      diskFreeBytes=usage.f_bavail * usage.f_frsize, diskTotalBytes=usage.f_blocks * usage.f_frsize,
                      generationId=plan['generationId'], attemptHash=hashlib.sha256(plan['nonce'].encode()).hexdigest()[:16],
                      proofSha256=dict(PHOTO_ATTEMPT_PROOFS), sourceSha256=dict(PHOTO_SPEED_SOURCES),
                      retainedHealthBoundBeforeAfter=True, retainedHealth=before_health,
                      savedSpeedResultWrittenAt=datetime.datetime.fromtimestamp(speed_written, datetime.timezone.utc).isoformat().replace('+00:00', 'Z'),
                      savedSpeedResultWrittenTimeNano=str(speed_written_ns),
                      rolledBackAt=rolled_back_at, startup=startup, homePhaseTiming=timing,
                      retainedLaunch=launch, historicalJournal=journal,
                      events={'since': since, 'until': until, 'historyIsFinite': True, 'emptyDoesNotExcludeFailure': True,
                              'exit137DoesNotProveOom': True, 'postFailureTerminalEventsMayBeCleanup': True, **events})
        print(json.dumps(report, separators=(',', ':')))
    finally:
        os.close(descriptor)


def image_binding_diagnostic():
    """Read one already retained public image; publish hashes and key names only."""
    identity = 'sha256:7b400c45db84145dd591043af255d7bbf41583189eda91fbe268b64b3d427e65'
    class Engine(http.client.HTTPConnection):
        def connect(self):
            self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            self.sock.settimeout(20)
            self.sock.connect('/var/run/docker.sock')
    con = Engine('localhost', timeout=20)
    try:
        con.request('GET', '/v1.52/images/' + identity + '/json?manifests=true',
                    headers={'Accept': 'application/json', 'Connection': 'close'})
        response = con.getresponse()
        raw = response.read(512 * 1024 + 1)
        if response.status != 200 or len(raw) > 512 * 1024:
            raise RuntimeError('photo_disk_image_api_response')
        api = json.loads(raw)
    finally:
        con.close()
    cli = docker_json(['image', 'inspect', '--format', '{{json .}}', identity])
    client = docker_json(['version', '--format', '{{json .Client}}'])
    def digest(value, canonical=False):
        return hashlib.sha256(json.dumps(value, separators=(',', ':'), ensure_ascii=False,
                                         sort_keys=canonical).encode()).hexdigest()
    def summary(value):
        return {'imageId': value.get('Id'), 'descriptorDigest': value.get('Descriptor', {}).get('digest'),
                'sizeBytes': value.get('Size'), 'os': value.get('Os'), 'architecture': value.get('Architecture'),
                'configSha256': digest(value.get('Config')), 'rootFsSha256': digest(value.get('RootFS')),
                'canonicalConfigSha256': digest(value.get('Config'), True),
                'canonicalRootFsSha256': digest(value.get('RootFS'), True),
                'configKeys': list((value.get('Config') or {}).keys()),
                'rootFsKeys': list((value.get('RootFS') or {}).keys())}
    result = {'imageId': identity, 'apiPathVersion': '1.52',
              'client': {key: client.get(key) for key in ('Version', 'ApiVersion', 'DefaultAPIVersion')},
              'cli': summary(cli), 'api': summary(api),
              'configStructurallyEqual': cli.get('Config') == api.get('Config'),
              'rootFsStructurallyEqual': cli.get('RootFS') == api.get('RootFS'),
              'configDifferentKeys': [key for key in sorted(set(cli.get('Config', {})) | set(api.get('Config', {})))
                                      if key not in cli.get('Config', {}) or key not in api.get('Config', {})
                                      or cli['Config'][key] != api['Config'][key]],
              'manifests': []}
    for manifest in api.get('Manifests', [])[:8]:
        data = manifest.get('ImageData') or {}
        result['manifests'].append({'id': manifest.get('ID'), 'kind': manifest.get('Kind'),
                                   'available': manifest.get('Available'), 'size': manifest.get('Size'),
                                   'platform': data.get('Platform'), 'snapshotSize': data.get('Size')})
    return result


def main():
    global PHASE, REPORT
    PHASE = 'disk'
    usage = os.statvfs(BASE)
    report = {'kind': 'photo-release-disk-readonly-v1',
              'diskFreeBytes': usage.f_bavail * usage.f_frsize,
              'diskTotalBytes': usage.f_blocks * usage.f_frsize}
    REPORT = report
    PHASE = 'lock'
    fd = os.open('/run/lock/avtocena-runtime-change.lock', os.O_RDONLY | os.O_NOFOLLOW)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            report['runtimeLockBusy'] = False
            fcntl.flock(fd, fcntl.LOCK_UN)
        except BlockingIOError:
            report['runtimeLockBusy'] = True
    finally:
        os.close(fd)
    PHASE = 'health'
    ingress = CONFIG.read_bytes()
    found = re.findall(rb'(?m)^\s*proxy_pass http://127\.0\.0\.1:(\d+);\s*$', ingress)
    if len(found) != 1:
        raise RuntimeError('photo_disk_ingress')
    con = http.client.HTTPConnection('127.0.0.1', int(found[0]), timeout=15)
    try:
        con.request('GET', '/api/health', headers={'Host': 'avtocena.com', 'Connection': 'close'})
        res = con.getresponse()
        raw = res.read(100000)
        health = json.loads(raw)
        report['health'] = {'status': res.status, 'ok': health.get('ok'),
                            'releaseSha': health.get('releaseSha'),
                            'calculationVersion': health.get('calculationVersion')}
    finally:
        con.close()
    PHASE = 'docker_list'
    ids_result = subprocess.run(['/usr/bin/docker', 'ps', '-aq', '--no-trunc'],
                                check=True, capture_output=True, text=True, timeout=30)
    ids = ids_result.stdout.splitlines()
    if len(ids) >= 150 or any(not re.fullmatch(r'[a-f0-9]{64}', row) for row in ids):
        raise RuntimeError('photo_disk_container_identity')
    mounted = []
    serving = []
    referenced_images = set()
    report['containers'] = []
    for identity in ids:
        PHASE = 'docker_inspect'
        row = docker_json(['inspect', identity])[0]
        if any(str(binding.get('HostPort', '')) == found[0].decode()
               for bindings in (row.get('HostConfig', {}).get('PortBindings') or {}).values() for binding in (bindings or [])):
            serving.append(row)
        referenced_images.add(row['Image'])
        mounts = [os.path.realpath(m['Source']) for m in row.get('Mounts', [])
                  if isinstance(m.get('Source'), str) and m['Source'].startswith('/')]
        mounted.extend(mounts)
        report['containers'].append({'id': identity[:12], 'running': row['State']['Running'],
                                     'imageId': row['Image'], 'releaseMounts':
                                     [m.split('/china-next/')[0] for m in mounts if m.startswith(str(BASE) + '/')]})
    PHASE = 'ajes_failure_metadata'
    if report['runtimeLockBusy']:
        report['ajesFailures'] = {'readStatus': 'skipped_runtime_busy', 'records': []}
    elif len(serving) != 1:
        raise RuntimeError('photo_disk_ajes_serving')
    else:
        report['ajesFailures'] = aj_failure_diagnostic(serving[0], int(found[0]), report['health'], ingress)
    report['runtimes'] = {}
    for runtime in RUNTIMES:
        PHASE = 'runtime_inventory'
        home = BASE / runtime / 'china-next'
        attempts = []
        if home.is_dir() and not home.is_symlink():
            for directory in sorted(home.iterdir()):
                if not re.fullmatch(r'[a-f0-9]{32}', directory.name) or not directory.is_dir() or directory.is_symlink():
                    continue
                if len(attempts) >= 40:
                    raise RuntimeError('photo_disk_attempt_limit')
                plan = proof(directory / 'PLAN.json')
                rollback = proof(directory / 'ROLLED_BACK.json')
                described = {r.get('name'): r for r in plan.get('files', []) if isinstance(r, dict)}
                files = {}
                for name in (*FILES, 'image.tar', 'details.sqlite.incoming.gz', 'query.sqlite.incoming.gz'):
                    item = directory / ('generation/' if name in FILES else '') / name
                    if ordinary(item):
                        st = item.stat()
                        files[name] = {'bytes': st.st_size, 'allocatedBytes': st.st_blocks * 512,
                                       'matchesDescribedSize': st.st_size == described.get(name, {}).get('bytes')}
                attempts.append({'attemptHash': hashlib.sha256(directory.name.encode()).hexdigest()[:16],
                    'mode': plan.get('mode'), 'controllerSha': plan.get('controllerSha'),
                    'planSha256': hashlib.sha256((directory / 'PLAN.json').read_bytes()).hexdigest() if plan else None,
                    'generationId': plan.get('generationId'),
                    'accepted': (directory / 'ACCEPTED.json').exists(),
                    'planInvalidJson': plan.get('_invalidJson', False),
                    'rollbackInvalidJson': rollback.get('_invalidJson', False),
                    'rollbackBytes': (directory / 'ROLLED_BACK.json').stat().st_size if ordinary(directory / 'ROLLED_BACK.json') else None,
                    'rollbackSha256': hashlib.sha256((directory / 'ROLLED_BACK.json').read_bytes()).hexdigest() if ordinary(directory / 'ROLLED_BACK.json') and (directory / 'ROLLED_BACK.json').stat().st_size <= 256 * 1024 else None,
                    'rollback': bool(rollback),
                    'rollbackBindsPlan': bool(rollback) and rollback.get('nonce') == plan.get('nonce') and
                        rollback.get('release') == plan.get('runtimeSha') and
                        rollback.get('generationManifestSha256') == plan.get('generationManifestSha256'),
                    'candidateRemoved': rollback.get('candidateRemoved'),
                    'ingressRestored': rollback.get('ingressRestored'),
                    'retainedRuntimeSha': rollback.get('retainedRuntimeSha'),
                    'mounted': any(m == str(directory) or m.startswith(str(directory) + '/') or
                                   str(directory).startswith(m + '/') for m in mounted),
                    'files': files,
                    **({'failedCodeCleanup': failed_code_cleanup_diagnostic(directory, runtime)}
                       if runtime in (RUNTIMES[0], RUNTIMES[3]) else {}),
                    **({'savedServerSpeed': saved_speed_diagnosis(directory, runtime)} if runtime == RUNTIMES[3] else {})})
        report['runtimes'][runtime] = attempts
    PHASE = 'journal'
    journal = subprocess.run(['/usr/bin/journalctl', '-u', 'docker', '-u', 'containerd',
                              '--since', '2026-11-25 13:23:00 UTC', '--until', '2026-11-25 13:27:00 UTC',
                              '--no-pager', '-o', 'cat'], capture_output=True, timeout=20)
    lines = journal.stdout[:4 * 1024 * 1024].decode('utf-8', errors='replace').lower().splitlines()
    report['dockerErrorCategories'] = {
        'noSpaceLeft': sum('no space left on device' in line for line in lines),
        'snapshotMissing': sum('snapshot' in line and ('not found' in line or 'does not exist' in line) for line in lines),
        'readOnlyFilesystem': sum('read-only file system' in line for line in lines),
        'inputOutputError': sum('input/output error' in line for line in lines),
        'journalAvailable': journal.returncode == 0,
    }
    PHASE = 'storage_totals'
    roots = ('/opt/avtocena/releases', '/var/lib/docker', '/var/lib/containerd', '/var/log', '/tmp')
    totals = subprocess.run(['/usr/bin/du', '-x', '-B1', '-s', *roots], capture_output=True, text=True, timeout=50)
    report['storageTotals'] = {}
    for line in totals.stdout.splitlines():
        parts = line.split('\t', 1)
        if len(parts) == 2 and parts[0].isdigit() and parts[1] in roots:
            report['storageTotals'][parts[1]] = int(parts[0])
    releases = subprocess.run(['/usr/bin/du', '-x', '-B1', '-d1', str(BASE)], capture_output=True, text=True, timeout=40)
    sizes = []
    for line in releases.stdout.splitlines():
        parts = line.split('\t', 1)
        if len(parts) == 2 and parts[0].isdigit() and re.fullmatch(re.escape(str(BASE)) + r'/[a-f0-9]{40}', parts[1]):
            sizes.append({'runtimeSha': Path(parts[1]).name, 'allocatedBytes': int(parts[0])})
    report['largestReleaseDirectories'] = sorted(sizes, key=lambda row: row['allocatedBytes'], reverse=True)[:20]
    usage = subprocess.run(['/usr/bin/docker', 'system', 'df', '--format', '{{json .}}'], capture_output=True, text=True, timeout=25)
    report['dockerStorageUsage'] = []
    if usage.returncode == 0:
        for line in usage.stdout.splitlines()[:8]:
            value = json.loads(line)
            report['dockerStorageUsage'].append({key: value.get(key) for key in ('Type', 'TotalCount', 'Active', 'Size', 'Reclaimable')})
    PHASE = 'image_inventory'
    image_ids_result = subprocess.run(['/usr/bin/docker', 'image', 'ls', '-aq', '--no-trunc'],
                                      capture_output=True, text=True, check=True, timeout=30)
    image_ids = sorted(set(image_ids_result.stdout.splitlines()))
    if len(image_ids) > 150 or any(not re.fullmatch(r'sha256:[a-f0-9]{64}', identity) for identity in image_ids):
        raise RuntimeError('photo_disk_image_identity')
    report['images'] = []
    for identity in image_ids:
        row = docker_json(['image', 'inspect', identity])[0]
        labels = row.get('Config', {}).get('Labels') or {}
        revision = labels.get('org.opencontainers.image.revision')
        report['images'].append({'id': identity, 'created': row.get('Created'), 'sizeBytes': row.get('Size'),
            'referencedByContainer': identity in referenced_images,
            'runtimeSha': revision if isinstance(revision, str) and re.fullmatch(r'[a-f0-9]{40}', revision) else None,
            'ownedApplication': labels.get('org.opencontainers.image.source') == 'https://github.com/jeep-jim/AvtoCena'
                and labels.get('avtocena.application') == 'web',
            'tagCount': len(row.get('RepoTags') or []), 'digestCount': len(row.get('RepoDigests') or []),
            'tags': [tag if re.fullmatch(r'avtocena-(?:regcloud|china-runtime):[a-f0-9-]+', tag) else '<other>'
                     for tag in (row.get('RepoTags') or [])[:10]]})
    PHASE = 'image_space'
    detailed = subprocess.run(['/usr/bin/docker', 'system', 'df', '-v'], capture_output=True, text=True, timeout=30)
    report['imageSpace'] = []
    short_ids = {identity.removeprefix('sha256:')[:12] for identity in image_ids}
    if detailed.returncode == 0:
        for line in detailed.stdout.splitlines():
            parts = re.split(r'\s{2,}', line.strip())
            if len(parts) == 8 and parts[2] in short_ids:
                report['imageSpace'].append({'id': parts[2], 'size': parts[4],
                    'sharedSize': parts[5], 'uniqueSize': parts[6], 'containers': parts[7]})
    PHASE = 'image_binding'
    report['imageBindingDiagnostic'] = image_binding_diagnostic()
    print(json.dumps(report, separators=(',', ':')))


if __name__ == '__main__':
    try:
        if PHOTO_ATTEMPT_ONLY:
            photo_attempt_only()
        else:
            main()
    except Exception as error:
        REPORT.update({'kind': 'photo-release-attempt-readonly-v1' if PHOTO_ATTEMPT_ONLY else 'photo-release-disk-readonly-v1',
                       'error': 'photo_disk_inventory_failed',
                       'phase': PHASE, 'errorType': type(error).__name__,
                       'errorNumber': getattr(error, 'errno', None),
                       'safeReason': str(error) if re.fullmatch(r'photo_disk_[a-z_]+', str(error)) else None})
        print(json.dumps(REPORT))
        raise SystemExit(1)
