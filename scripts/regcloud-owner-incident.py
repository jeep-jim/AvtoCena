#!/usr/bin/env python3
"""Read only a closed owner-incident window. No catalog/provider requests."""
import collections, datetime, json, math, pathlib, re, subprocess, sys, urllib.request
CODES=('detail_cache_queue_timeout','detail_cache_queue_full','visitor_restricted','request_failed','request_timeout','connect_timeout','local_busy','object_storage_response_timeout','object_storage_request_failed','ajes_currency_unavailable','invalid_response','empty_response','read_deadline','ETIMEDOUT','ECONNRESET','TypeError','heap out of memory','FATAL ERROR','ENOMEM','home_initial_catalog_failed','home_initial_pricing_failed')
HOME_PHASES=frozenset(('snapshot','counts','green','greenPricing','catalogPricing','dealer','dealerRail','japanRail','snapshotContext','snapshotBody','snapshotPrepared','snapshotManifest','snapshotOverview','snapshotProjection')) | frozenset('snapshotEditorial:'+market for market in ('china','japan','korea','uae','europe','georgia'))

def storage_category(path):
    # Only fixed labels leave this process; no path fragment, listing or generation ID.
    if not isinstance(path,str) or not path.startswith('catalog/') or len(path)>4096:
        return None
    if path=='catalog/manifest.json':return 'manifest'
    if path.startswith('catalog/partner-cache/ajes/queries/'):return 'partnerQueryCache'
    if path.startswith('catalog/partner-cache/'):return 'partnerOtherCache'
    if path.startswith('catalog/current-offers/'):return 'currentOfferShards'
    if path.startswith('catalog/operations/'):return 'operations'
    generation=re.fullmatch(r'catalog/generations/[^/]+/(.+)',path)
    if generation:
        suffix=generation.group(1)
        if suffix.startswith(('offers/','current-offers/')):return 'generationOfferShards'
        if suffix.startswith(('indexes/projection/','indexes/projection-brand/','indexes/projection-parts/')):return 'projectionIndexes'
        if suffix.startswith('indexes/budget-'):return 'budgetIndexes'
        if suffix.startswith('indexes/market-landing-') or suffix=='indexes/overview.json':return 'landingIndexes'
        if suffix.startswith('indexes/'):return 'otherGenerationIndexes'
        return 'otherGenerationData'
    return 'otherCatalog'

def summarize_timings(logs):
    """Aggregate existing timing records, never copy log-controlled strings to output."""
    groups={'storage':{},'home':{}}
    accepted=collections.Counter();rejected=collections.Counter()
    for line in logs.splitlines():
        match=re.match(r'^(?:\d{4}-\d\d-\d\dT[0-9:.]+Z )?(catalog_storage_read|home_phase) (.*)$',line)
        if not match:continue
        kind='storage' if match.group(1)=='catalog_storage_read' else 'home'
        try:
            if len(match.group(2))>32768:raise ValueError('oversized_timing')
            row=json.loads(match.group(2))
            if not isinstance(row,dict):raise ValueError('invalid_timing')
            ms=row.get('ms')
            if type(ms) not in (int,float) or not math.isfinite(ms) or not 0<=ms<=2**53-1:
                raise ValueError('invalid_duration')
            label=storage_category(row.get('path')) if kind=='storage' else row.get('phase')
            valid_label=label is not None if kind=='storage' else isinstance(label,str) and label in HOME_PHASES
            flag=row.get('found' if kind=='storage' else 'ok')
            if not valid_label or type(flag) is not bool:raise ValueError('invalid_fields')
        except (ValueError,TypeError,OverflowError,RecursionError):
            rejected[kind]+=1
            continue
        summary=groups[kind].setdefault(label,{'count':0,'totalMs':0,'maxMs':0,'over1000Ms':0,'negativeOutcomeCount':0})
        summary['count']+=1;summary['totalMs']+=ms;summary['maxMs']=max(summary['maxMs'],ms)
        summary['over1000Ms']+=int(ms>1000);summary['negativeOutcomeCount']+=int(not flag)
        accepted[kind]+=1
    result={}
    for kind,categories in groups.items():
        rows=[]
        for label,summary in sorted(categories.items()):
            rows.append({'category':label,**summary,'totalMs':round(summary['totalMs'],3),'maxMs':round(summary['maxMs'],3),'meanMs':round(summary['totalMs']/summary['count'],3)})
        result[kind]={'acceptedRows':accepted[kind],'rejectedRows':rejected[kind],'categories':rows}
    # Empty output does not prove fast storage: these hooks may be disabled or absent.
    result['coverage']='Existing log samples only; storage logger emits reads over 250ms, not all storage operations. Durations may overlap and are not page latency.'
    return result
def summarize(logs):
    # Deliberately no raw lines, paths, IDs, query strings, messages or stacks.
    return {code:logs.count(code) for code in CODES}
def run(args):
    return subprocess.run(args,capture_output=True,text=True,timeout=25,check=True).stdout
def health():
    port=run(['docker','inspect','--format','{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}','avtocena-production']).strip()
    assert port.isdigit(),'invalid_port'
    with urllib.request.urlopen('http://127.0.0.1:'+port+'/api/health',timeout=5) as r:
        value=json.loads(r.read(16384))
    sha=value.get('releaseSha','')
    assert value.get('ok') and re.fullmatch('[a-f0-9]{40}',sha),'invalid_health'
    return sha
def main():
    expected,start,end=sys.argv[1:]
    assert re.fullmatch('[a-f0-9]{40}',expected),'invalid_release'
    assert all(re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z',s) for s in [start,end]),'invalid_window'
    a,b=(datetime.datetime.fromisoformat(s.replace('Z','+00:00')) for s in [start,end])
    assert 0<(b-a).total_seconds()<=600 and b<=datetime.datetime.now(datetime.timezone.utc),'window_not_closed'
    before=health();assert before==expected,'production_changed'
    nginx=pathlib.Path('/etc/nginx/conf.d/avtocena-prepare.conf').read_bytes()
    p=subprocess.run(['docker','logs','--since',start,'--until',end,'--tail','5000','avtocena-production'],capture_output=True,text=True,timeout=25,check=True)
    logs=p.stdout+'\n'+p.stderr
    assert len(logs.encode())<=32*1024*1024,'log_window_too_large'
    print(json.dumps({'closedWindow':[start,end],'lineCount':len(logs.splitlines()),'categoryMentions':summarize(logs),'timings':summarize_timings(logs)}),flush=True)
    after=health()
    same=nginx==pathlib.Path('/etc/nginx/conf.d/avtocena-prepare.conf').read_bytes()
    print(json.dumps({'productionBefore':before,'productionAfter':after,'nginxUnchanged':same}),flush=True)
    assert after==expected and same,'production_changed'
if __name__=='__main__':main()
