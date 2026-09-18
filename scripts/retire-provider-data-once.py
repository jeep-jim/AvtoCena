import json,re,collections,subprocess
from pathlib import Path
pattern=re.compile(r'drom|дром',re.I)
contains=lambda x:bool(pattern.search(json.dumps(x,ensure_ascii=False)))
report=collections.Counter()
# Remove legacy provider records, never relabel their facts as another source.
root=Path('data/catalog/vehicle-knowledge')
for p in root.glob('*.json'):
 obj=json.loads(p.read_text())
 if isinstance(obj,list):
  clean=[r for r in obj if not contains(r)];report['legacy_records_removed']+=len(obj)-len(clean)
  if clean!=obj:p.write_text(json.dumps(clean,ensure_ascii=False,indent=2)+'\n')
for p in root.glob('*index.json'):
 obj=json.loads(p.read_text());chunks=obj.get('chunks') if isinstance(obj,dict) else None
 if not isinstance(chunks,list):continue
 changed=False
 for item in chunks:
  if not isinstance(item,dict) or 'file' not in item:continue
  f=root/item['file']
  if f.exists():
   rows=json.loads(f.read_text());n=len(rows) if isinstance(rows,list) else len(rows.get('records',[]));changed|=item.get('count')!=n;item['count']=n
 if changed:obj['total']=sum(x['count'] for x in chunks);p.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
for p in root.glob('*drom*'):p.unlink()
# Remove retired evidence from staged entities, preserving independent evidence.
root=Path('data/catalog/vehicle-encyclopedia-v2/chunks'); chunks=[(p,json.loads(p.read_text())) for p in sorted(root.glob('*.json'))]
banned=set()
for p,obj in chunks:
 for r in obj['records']:
  if obj['entityType']=='source' and contains(r):banned.add(r['id'])
sources={r['id']:r for _,o in chunks if o['entityType']=='source' for r in o['records']}
models=[r for _,o in chunks if o['entityType']=='model' for r in o['records']]
for _,o in chunks:
 if o['entityType']!='brand':continue
 for r in o['records']:
  if not contains(r):continue
  independent=[]
  for m in models:
   if m.get('brandId')!=r['id'] or contains(m):continue
   for e in m.get('evidence',[]):
    source=sources.get(e.get('sourceId'),{})
    if e.get('sourceId') not in banned and 'canonicalName' in source.get('supportedFields',[]):independent.append((m,e))
  if independent and not any(e.get('sourceId') not in banned for e in r.get('evidence',[])):
   m,e=independent[0]
   r['evidence'].append({'sourceId':e['sourceId'],'fields':['canonicalName'],'status':'verified','confidence':'high','note':'Brand identity retained through independently sourced canonical model '+m['id']+'. No retired catalog technical facts retained.'})
   report['brand_identity_preserved_from_independent_model']+=1
for p,obj in chunks:
 kind=obj['entityType'];kept=[]
 for r in obj['records']:
  if r['id'] in banned or pattern.search(r['id']):banned.add(r['id']);report[kind+'_removed']+=1;continue
  if kind=='media' and (r.get('sourceId') in banned or contains(r)):banned.add(r['id']);report[kind+'_removed']+=1;continue
  if contains(r):
   r['evidence']=[e for e in r.get('evidence',[]) if e.get('sourceId') not in banned and not contains(e)]
   for key in ['aliases','sourceNames']:
    if key in r:r[key]=[a for a in r[key] if not contains(a) and not any(s in banned for s in a.get('sourceIds',[]))]
   if 'researchNotes' in r:r['researchNotes']=[n for n in r['researchNotes'] if not contains(n)]
   if not r.get('evidence') or contains(r):banned.add(r['id']);report[kind+'_removed']+=1;continue
  kept.append(r)
 obj['records']=kept
# Close relationships without leaving orphan variants or media.
while True:
 removed=0
 for p,obj in chunks:
  kept=[]
  for r in obj['records']:
   if any(r.get(k) in banned for k in ['brandId','modelId','generationId','faceliftId','ownerId','sourceId']):banned.add(r['id']);report[obj['entityType']+'_dependent_removed']+=1;removed+=1
   else:kept.append(r)
  obj['records']=kept
 if not removed:break
for p,obj in chunks:
 for r in obj['records']:
  if 'mediaIds' in r:r['mediaIds']=[i for i in r['mediaIds'] if i not in banned]
 old=p.read_text();new=json.dumps(obj,ensure_ascii=False,indent=2)+'\n'
 if json.loads(old)!=obj:p.write_text(new)
# Historical generated reports and provider-specific ingestion archives are obsolete after retirement.
for base in ['data/catalog/research','data/catalog/vehicle-encyclopedia-v2/ingest','data/catalog/vehicle-encyclopedia-v2/reports','data/catalog/vehicle-encyclopedia-v2/generated/legacy-bridge-preview']:
 for p in Path(base).rglob('*'):
  if p.is_file():
   try:hit=pattern.search(p.read_text())
   except UnicodeDecodeError:continue
   if hit:p.unlink();report['retired_reports_removed']+=1
for p in Path('apps/web/public/brand-logos').rglob('*.json'):
 if contains(json.loads(p.read_text())):p.unlink();report['retired_asset_reports_removed']+=1
Path('/tmp/retired-source-purge-report.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
# Retain the independently documented EEA model spelling used by search.
root=Path('data/catalog/vehicle-encyclopedia-v2/chunks')
sources={r['id']:r for p in root.glob('sources-*.json') for r in json.loads(p.read_text())['records']}
p=Path('data/catalog/vehicle-knowledge/models.json');rows=json.loads(p.read_text());rows.insert(0,{'id':'honda/hr-v','make':'Honda','model':'HR-V','makeAliases':[],'aliases':['HRV'],'bodyTypes':[],'source':'manual','sourceUrl':sources['src-eea-co2cars-2020-2022-final']['url'],'updatedAt':'2026-09-18T00:00:00.000Z','active':True});p.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
p=Path('data/catalog/brand-logo-supplement.json');p.write_text(p.read_text().replace('brand-logos/drom','brand-logos/local'))
paths=subprocess.run(['git','grep','-il','-E','drom|Дром'],capture_output=True,text=True).stdout.splitlines()
for name in paths:
 if name.startswith(('data/catalog/research/','data/catalog/vehicle-encyclopedia-v2/ingest/','data/catalog/vehicle-encyclopedia-v2/reports/','data/catalog/vehicle-encyclopedia-v2/research/','data/catalog/vehicle-encyclopedia-v2/generated/legacy-bridge-preview/','apps/web/public/brand-logos/')):Path(name).unlink(missing_ok=True)
for name in ['roadmap.md',*subprocess.run(['git','grep','-il','-E','drom|Дром','--','docs'],capture_output=True,text=True).stdout.splitlines()]:
 p=Path(name);p.write_text('\n\n'.join(x for x in p.read_text().split('\n\n') if not pattern.search(x)))
