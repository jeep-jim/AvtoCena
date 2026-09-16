"""Verify saved evidence without publishing or persisting image bytes."""
import collections, datetime as dt, hashlib, io, json, pathlib, time, urllib.request, urllib.error
from PIL import Image
rows={}
for p in pathlib.Path('audit-input').rglob('part-*.json'):
    if 'aggregate' in str(p): continue
    for r in json.loads(p.read_text()): rows[(r['source'],r['sourceId'])]=r
reports=[]; verified=[]; checks={}; blocked=set()
def check(url):
    if url in checks:return checks[url]
    host=urllib.parse.urlsplit(url).netloc
    if host in blocked:return {'ok':False,'error':'host_rate_or_access_limit'}
    time.sleep(.5)
    try:
        req=urllib.request.Request(url,headers={'User-Agent':'AvtoCena catalog research/1.0','Accept':'image/*'})
        with urllib.request.urlopen(req,timeout=20) as response:
            data=response.read(8000001)
            if len(data)>8000000:raise ValueError('image_too_large')
            mime=response.headers.get_content_type()
        with Image.open(io.BytesIO(data)) as im:
            im.load(); width,height=im.size; fmt=im.format
        result={'ok':mime.startswith('image/') and min(width,height)>=150,'width':width,'height':height,'format':fmt,'sha256':hashlib.sha256(data).hexdigest()}
    except Exception as e:
        if isinstance(e,urllib.error.HTTPError) and e.code in (401,403,429):blocked.add(host)
        result={'ok':False,'error':str(e)}
    checks[url]=result
    return result
for r in rows.values():
    if not r.get('qualifiedSoldCandidate'):continue
    hashes=set(); good=[]
    for url in r.get('imageUrls',[]):
        result=check(url)
        if result['ok'] and result['sha256'] not in hashes:
            hashes.add(result['sha256']);good.append(url)
        if len(good)>=2:break
    record={'source':r['source'],'sourceId':r['sourceId'],'sourceUrl':r['sourceUrl'],'verifiedDistinctImages':good,'passedImageCheck':len(good)>=2}
    reports.append(record)
    if len(good)>=2:
        verified.append({**r,'verifiedImageUrls':good,'minimumGalleryVerified':True,'publicationReady':False})
out=pathlib.Path('japan-free-verification');out.mkdir(exist_ok=True)
(out/'checks.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2))
(out/'records.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2))
for i in range(0,len(verified),250):
    (out/('part-%06d.json'%(i//250+1))).write_text(json.dumps(verified[i:i+250],ensure_ascii=False))
summary={'checkedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'savedUniqueBySource':dict(collections.Counter(r['source'] for r in rows.values())),'soldCandidatesChecked':len(reports),'candidatesWithTwoDecodedDistinctImages':len(verified),'publicationReady':False,'remainingChecks':['Visual photo versus auction-sheet classification','Site integration and calculation completeness'],'failed':[r for r in reports if not r['passedImageCheck']],'blockedHosts':sorted(blocked)}
(out/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
p=pathlib.Path('data/japan-free-discovery/image-verification-summary.json');p.write_text(json.dumps(summary,ensure_ascii=False,indent=2))
print(json.dumps(summary,ensure_ascii=False))
