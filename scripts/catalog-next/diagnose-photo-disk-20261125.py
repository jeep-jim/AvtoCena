"""Bounded, read-only disk, rollback and retained AJ-failure evidence."""
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import socket
import stat
import subprocess

BASE = Path('/opt/avtocena/releases')
CONFIG = Path('/etc/nginx/conf.d/avtocena-prepare.conf')
RUNTIMES = (
    '4302f59a0312f35a64fc3cb9c5b25f9463fa9294',
    'd536c1547c4d82a339ed68ced7d8503f09b6810b',
    '38895e53f7f770ee68edb0b8ad53056468b928a5',
    '36d707bcb599e861918df411e40d8947074f0430',
)
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


def bounded_proof(path, limit):
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
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise ValueError()
        return value, hashlib.sha256(raw).hexdigest()
    finally:
        os.close(descriptor)


def failed_code_cleanup_diagnostic(directory):
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
                    and value.get('runtimeSha') == RUNTIMES[0] == plan.get('runtimeSha') == rollback.get('release'),
                'bindsPlan': value.get('planSha256') == plan_digest,
                'bindsRollback': value.get('rollbackSha256') == rollback_digest}
    except (OSError, ValueError, UnicodeDecodeError):
        return {'present': True, 'valid': False, 'receiptSha256': digest}


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
                    **({'failedCodeCleanup': failed_code_cleanup_diagnostic(directory)} if runtime == RUNTIMES[0] else {})})
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
        main()
    except Exception as error:
        REPORT.update({'kind': 'photo-release-disk-readonly-v1', 'error': 'photo_disk_inventory_failed',
                       'phase': PHASE, 'errorType': type(error).__name__,
                       'errorNumber': getattr(error, 'errno', None),
                       'safeReason': str(error) if re.fullmatch(r'photo_disk_[a-z_]+', str(error)) else None})
        print(json.dumps(REPORT))
        raise SystemExit(1)
