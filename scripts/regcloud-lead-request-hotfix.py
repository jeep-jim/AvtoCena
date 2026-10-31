"""One-release emergency repair for the reproduced Node 24 Request Proxy failure.
Only /api/leads compiled handler changes; no catalogs, pricing or customer records.
The tracked source fix supersedes this patch on the next ordinary release.
"""
import hashlib,json,pathlib,re,subprocess,time,urllib.request,urllib.error
EXPECTED='5e45cd9478a7d38a6c57adc7d81061e475055cf9'
ROUTE='/app/apps/web/.next/server/app/(public)/api/leads/route.js'
BACKUP=pathlib.Path('/opt/avtocena/incidents/lead-request-20261031')
def run(*args): return subprocess.check_output(args,text=True,timeout=60).strip()
def request(path,body=None,origin='https://avtocena.com'):
    req=urllib.request.Request('http://127.0.0.1:3000'+path,data=json.dumps(body).encode() if body is not None else None,headers={'Host':'avtocena.com','Origin':origin,'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=25) as r:return r.status,json.loads(r.read())
    except urllib.error.HTTPError as e:
        raw=e.read()
        try:parsed=json.loads(raw)
        except ValueError:parsed={}
        return e.code,parsed
status,health=request('/api/health')
assert status==200 and health['releaseSha']==EXPECTED,'Release changed; refusing patch'
BACKUP.mkdir(parents=True,exist_ok=True,mode=0o700)
old=BACKUP/'route.original.js';new=BACKUP/'route.fixed.js'
assert not old.exists(),'Incident backup already exists; inspect before retry'
run('docker','cp','avtocena-production:'+ROUTE,str(old))
s=old.read_text()
pattern=r'new Request\(([A-Za-z_$][\w$]*),\{headers:([A-Za-z_$][\w$]*)\}\)'
matches=list(re.finditer(pattern,s));assert len(matches)==1,'Unexpected compiled request shape'
m=matches[0];a,h=m.groups()
replacement=f'new Request({a}.url,{{method:{a}.method,headers:{h},body:await {a}.text(),signal:{a}.signal}})'
new.write_text(s[:m.start()]+replacement+s[m.end():])
print('LEAD_PATCH',json.dumps({'releaseSha':EXPECTED,'beforeSha256':hashlib.sha256(old.read_bytes()).hexdigest(),'afterSha256':hashlib.sha256(new.read_bytes()).hexdigest(),'replacements':1}),flush=True)
run('docker','cp',str(new),'avtocena-production:/tmp/lead-request-fixed.cjs')
run('docker','exec','avtocena-production','node','--check','/tmp/lead-request-fixed.cjs')
changed=False
try:
    run('docker','cp',str(new),'avtocena-production:'+ROUTE);changed=True
    run('docker','restart','avtocena-production')
    for attempt in range(20):
        try:
            status,health=request('/api/health')
            if status==200:break
        except (OSError,ValueError):pass
        time.sleep(1)
    assert status==200 and health['releaseSha']==EXPECTED
    status,body=request('/api/leads',{})
    assert status==400 and body.get('error')=='personal_data_consent_required',f'Validation failed: {status}'
    status,body=request('/api/leads',{},'https://foreign.example')
    assert status==403 and body.get('error')=='origin_forbidden'
    print('LEAD_HOTFIX_ACTIVE',json.dumps({'releaseSha':EXPECTED,'emptyRequest':400,'foreignOrigin':403,'catalogChanged':False}),flush=True)
except BaseException:
    if changed:
        run('docker','cp',str(old),'avtocena-production:'+ROUTE)
        run('docker','restart','avtocena-production')
        print('LEAD_HOTFIX_ROLLED_BACK',flush=True)
    raise
