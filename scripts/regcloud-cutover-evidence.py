#!/usr/bin/env python3
"""Read a stopped failed candidate and current runtime; no start/exec/probes or env output."""
import collections, json, re, subprocess, sys, io, tarfile

release = sys.argv[1]
assert re.fullmatch(r'[a-f0-9]{40}', release)
since = sys.argv[2] if len(sys.argv)>2 else '2026-11-10T03:27:00Z'
until = sys.argv[3] if len(sys.argv)>3 else '2026-11-10T03:36:00Z'
assert all(re.fullmatch(r'[0-9TZ:-]{20}', value) for value in (since, until))
assert since < until

def run(args):
    return subprocess.run(args, capture_output=True, text=True, timeout=25, check=True).stdout

def inspect(name):
    # Docker env/labels can contain secrets: request only these explicit fields.
    fmt = '{"running":{{.State.Running}},"oomKilled":{{.State.OOMKilled}},"restarts":{{.RestartCount}},"started":"{{.State.StartedAt}}","finished":"{{.State.FinishedAt}}","exit":{{.State.ExitCode}},"memoryLimit":{{.HostConfig.Memory}},"cpuLimit":{{.HostConfig.NanoCpus}}}'
    return json.loads(run(['docker','inspect','--format',fmt,name]))

for label,name in [('failed','avtocena-release-'+release[:12]),('production','avtocena-production')]:
    state=inspect(name)
    if label=='failed':assert not state['running'], 'candidate_is_still_running_do_not_duplicate'
    print('CUTOVER_STATE',json.dumps({'target':label,**state}),flush=True)
    # Closed incident interval, not a new load test. Both streams only go through
    # allowlisted aggregate extraction; no URLs, addresses, source bodies or keys.
    p=subprocess.run(['docker','logs','--since',since,'--until',until,'--tail','12000',name],capture_output=True,text=True,timeout=25,check=True)
    logs=p.stdout+'\n'+p.stderr
    categories=['detail_cache_queue_timeout','detail_cache_queue_full','visitor_restricted','read_deadline','object_storage_response_timeout','ETIMEDOUT','ECONNRESET','TypeError','heap out of memory','FATAL ERROR','ENOMEM','home_initial_catalog_failed','home_initial_pricing_failed']
    print('CUTOVER_ERRORS',json.dumps({'target':label,'counts':{k:logs.count(k) for k in categories}}),flush=True)
    # Error diagnostics contain only allowlisted market labels, exception names and stack frames.
    for i,line in enumerate(logs.splitlines()):
        if 'catalog_market_unavailable' in line or 'catalog_page_unavailable' in line:
            block=logs.splitlines()[i:i+16]
            safe=[line[:160] for line in block if re.match(r"^\s*(?:market: '(?:china|uae|europe|georgia|korea|japan)'|(?:name|code|message): '[a-zA-Z0-9_:.-]{1,120}'|at [a-zA-Z0-9_.$]+ \(|Error: [a-zA-Z0-9_:.-]+)",line)]
            print('CUTOVER_CATALOG_FAILURE',json.dumps({'target':label,'details':safe}),flush=True)
    error_tokens = collections.Counter(re.findall(r"(?:Error:|code:)\s*[\"']?([A-Za-z][A-Za-z0-9_-]{0,80})", logs))
    print('CUTOVER_ERROR_TOKENS',json.dumps({'target':label,'tokens':error_tokens}),flush=True)
    stacks=[re.sub(r'https?://[^ )]+','[url]',line)[:250] for line in logs.splitlines() if re.match(r'^\s+at [A-Za-z0-9_.$ (]',line)]
    print('CUTOVER_STACKS',json.dumps({'target':label,'frames':stacks[-60:]}),flush=True)
    print('CUTOVER_RUNTIME_FILES',json.dumps({'target':label,'missingModule':logs.count('Cannot find module'),'ENOENT':logs.count('ENOENT'),'ChunkLoadError':logs.count('ChunkLoadError')}),flush=True)
    if label=='failed' and release=='1585eb6f1774d2f3d5f7d47b9b8aeda323ff7aa6':
        # The image was built without production credentials. Read static code only.
        archive=subprocess.run(['docker','cp',name+':/app/apps/web/.next/server/chunks/7272.js','-'],capture_output=True,timeout=25,check=True).stdout
        with tarfile.open(fileobj=io.BytesIO(archive)) as files:
            source=files.extractfile(files.getmembers()[0]).read().decode('utf8')
        print('CUTOVER_STATIC_CALLER',source[2445:3845],flush=True)
    grouped=collections.defaultdict(list)
    for line in logs.splitlines():
        m=re.search(r'catalog_storage_read (\{[^\n]+\})',line)
        if not m:continue
        try:v=json.loads(m[1])
        except ValueError:continue
        path=v.get('path','');ms=v.get('ms')
        if not isinstance(ms,(float,int)) or isinstance(ms,bool) or ms<0:continue
        category=next((label for needle,label in [('encyclopedia','encyclopedia'),('projection','projection'),('partner-cache/ajes','ajes-cache'),('budget','budget'),('overview','overview'),('price','prices'),('editorial','editorial')] if needle in path),'other-catalog')
        grouped[category].append(ms)
    print('CUTOVER_STORAGE',json.dumps({'target':label,'groups':[{ 'category':k,'readsOver250ms':len(v),'maxMs':max(v),'meanMs':round(sum(v)/len(v),1)} for k,v in sorted(grouped.items())]}),flush=True)
print('CURRENT_RESOURCES',run(['docker','stats','--no-stream','--format','memory={{.MemUsage}} cpu={{.CPUPerc}}','avtocena-production']).strip(),flush=True)
print('CUTOVER_READ_ONLY_COMPLETE',flush=True)
