#!/usr/bin/env python3
"""Read a stopped failed candidate and current runtime; no start/exec/probes or env output."""
import collections, json, re, subprocess, sys

release = sys.argv[1]
assert re.fullmatch(r'[a-f0-9]{40}', release)

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
    p=subprocess.run(['docker','logs','--since','2026-10-27T13:51:00Z','--until','2026-10-27T14:00:00Z','--tail','12000',name],capture_output=True,text=True,timeout=25,check=True)
    logs=p.stdout+'\n'+p.stderr
    categories=['detail_cache_queue_timeout','detail_cache_queue_full','visitor_restricted','read_deadline','object_storage_response_timeout','ETIMEDOUT','ECONNRESET','TypeError','heap out of memory','FATAL ERROR','ENOMEM','home_initial_catalog_failed','home_initial_pricing_failed']
    print('CUTOVER_ERRORS',json.dumps({'target':label,'counts':{k:logs.count(k) for k in categories}}),flush=True)
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
