#!/usr/bin/env python3
"""Read only a closed owner-incident window. No catalog/provider requests."""
import collections, datetime, hashlib, json, pathlib, re, subprocess, sys, urllib.request
CODES=('detail_cache_queue_timeout','detail_cache_queue_full','visitor_restricted','request_failed','request_timeout','connect_timeout','local_busy','object_storage_response_timeout','object_storage_request_failed','ajes_currency_unavailable','invalid_response','empty_response','read_deadline','ETIMEDOUT','ECONNRESET','TypeError','heap out of memory','FATAL ERROR','ENOMEM','home_initial_catalog_failed','home_initial_pricing_failed')
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
    print(json.dumps({'closedWindow':[start,end],'lineCount':len(logs.splitlines()),'categoryMentions':summarize(logs)}),flush=True)
    after=health()
    same=nginx==pathlib.Path('/etc/nginx/conf.d/avtocena-prepare.conf').read_bytes()
    print(json.dumps({'productionBefore':before,'productionAfter':after,'nginxUnchanged':same}),flush=True)
    assert after==expected and same,'production_changed'
if __name__=='__main__':main()
