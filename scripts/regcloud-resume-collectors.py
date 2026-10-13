"""Restore only required collectors that were active before migration."""
import io,json,os,urllib.request,urllib.error,zipfile
from pathlib import Path
repo='jeep-jim/AvtoCena'
assert os.environ['GITHUB_REPOSITORY']==repo and os.environ['GITHUB_REF']=='refs/heads/main'
headers={'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json'}
def api(path,method='GET'):
    req=urllib.request.Request('https://api.github.com/repos/'+repo+path,headers=headers,method=method)
    with urllib.request.urlopen(req,timeout=30) as r:
        data=r.read()
        return json.loads(data) if data else None
names=['catalog-refresh-china','catalog-refresh-korea','catalog-refresh-europe','catalog-refresh-uae','catalog-refresh-georgia','catalog-refresh-green','catalog-market-refresh']
paths={'.github/workflows/'+name+'.yml' for name in names}
for name in ['catalog-market-refresh','catalog-refresh-green']:
    text=Path('.github/workflows/'+name+'.yml').read_text()
    assert 'secrets.YC_OBJECT_STORAGE' not in text
    for line in ['https://s3.regru.cloud','avtocena-staging-8120751','migration-staging/full-20261011/','environment: regcloud-staging','secrets.REGCLOUD_S3_ACCESS_KEY_ID','secrets.REGCLOUD_S3_SECRET_ACCESS_KEY']:
        assert line in text,(name,line)
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args): return None
def snapshot(artifact):
    try:
        urllib.request.build_opener(NoRedirect).open(urllib.request.Request(artifact['archive_download_url'],headers=headers),timeout=30)
        raise RuntimeError('Expected artifact redirect')
    except urllib.error.HTTPError as e:
        if e.code!=302: raise
        location=e.headers['Location']
    if not location.startswith('https://'):raise RuntimeError('Invalid artifact redirect')
    with urllib.request.urlopen(location,timeout=30) as r:data=r.read(2_000_001)
    if len(data)>2_000_000:raise RuntimeError('Snapshot archive too large')
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        info=z.getinfo('regcloud-paused-workflows.json')
        if info.file_size>2_000_000:raise RuntimeError('Snapshot too large')
        return json.loads(z.read(info))
artifacts=[]
for page in range(1,11):
    rows=api(f'/actions/artifacts?per_page=100&page={page}')['artifacts']
    artifacts.extend(a for a in rows if a['name'].startswith('regcloud-paused-workflows-') and not a['expired'])
    if len(rows)<100:break
approved=set();evidence=[]
# Later attempts may record already-disabled states. The first preserved pause
# records which jobs migration actually disabled. Never enable unrelated jobs.
for artifact in sorted(artifacts,key=lambda a:a['created_at'],reverse=True):
    state=snapshot(artifact)
    active={w['path'] for w in state.get('workflows',[]) if w['state']=='active' and w['path'] in paths and w['id'] in state.get('disabled',[])}
    approved|=active
    evidence.append({'artifact':artifact['id'],'run':state.get('runId'),'requiredPreviouslyActive':sorted(active)})
if not approved:raise RuntimeError('No preserved evidence of active collectors; restore refused')
print(json.dumps({'migrationEvidence':evidence,'restorePaths':sorted(approved)}),flush=True)
for path in sorted(approved):
    name=Path(path).name
    current=api('/actions/workflows/'+name)
    if current['state']=='disabled_manually':
        api('/actions/workflows/'+str(current['id'])+'/enable','PUT')
    elif current['state']!='active':raise RuntimeError('Unexpected workflow state')
    verified=api('/actions/workflows/'+str(current['id']))
    if verified['state']!='active':raise RuntimeError('Restore not verified')
    print(json.dumps({'workflow':name,'state':verified['state']}),flush=True)
