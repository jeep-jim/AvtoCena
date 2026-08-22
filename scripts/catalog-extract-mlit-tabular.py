import csv, hashlib, io, json, os, re, time, urllib.request, zipfile
from pathlib import Path

ROOT=Path(os.environ.get('KNOWLEDGE_OUTPUT_ROOT','data/catalog/knowledge-source-snapshots/generated'))
MLIT=ROOT/'mlit'; OUT=MLIT/'tabular-json'; OUT.mkdir(parents=True,exist_ok=True)
for p in OUT.glob('*'): p.unlink()
refs=json.loads((MLIT/'discovered-attachments.json').read_text('utf-8'))
keep=re.compile(r'普通.{0,4}小型自動車|軽自動車|輸入自動車|プラグインハイブリッド|電気自動車|乗用車|WLTC|JC08',re.I)
selected=[]; seen=set()
for x in refs:
    if x.get('kind')!='tabular_attachment' or not keep.search(str(x.get('text',''))): continue
    if x['url'] in seen: continue
    seen.add(x['url']); selected.append(x)
max_files=max(10,min(300,int(os.environ.get('KNOWLEDGE_MLIT_TABLE_MAX','200')))); selected=selected[:max_files]
manifest={'schemaVersion':1,'id':'mlit-japan-tabular-passenger-data','authority':'government_type_approval_efficiency','fetchedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'status':'complete','selected':len(selected),'converted':0,'failed':0,'files':[],'errors':[]}

def download(url):
    req=urllib.request.Request(url,headers={'User-Agent':'AvtoCena-KnowledgeCORE/1.0 (+https://avtocena.com; MLIT public-data snapshot)','Accept':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,application/zip,*/*'})
    with urllib.request.urlopen(req,timeout=60) as r:
        b=r.read(30_000_001)
        if len(b)>30_000_000: raise RuntimeError('attachment_too_large')
        return b

def xlsx_rows(data):
    import openpyxl
    wb=openpyxl.load_workbook(io.BytesIO(data),read_only=True,data_only=True)
    sheets=[]
    for ws in wb.worksheets:
        rows=[]
        for row in ws.iter_rows(values_only=True):
            vals=[None if v is None else (v.isoformat() if hasattr(v,'isoformat') else v) for v in row]
            while vals and vals[-1] is None: vals.pop()
            if any(v not in (None,'') for v in vals): rows.append(vals)
        sheets.append({'name':ws.title,'rows':rows})
    return sheets

def xls_rows(data):
    import xlrd
    wb=xlrd.open_workbook(file_contents=data)
    sheets=[]
    for sh in wb.sheets():
        rows=[]
        for r in range(sh.nrows):
            vals=[sh.cell_value(r,c) for c in range(sh.ncols)]
            while vals and vals[-1] in ('',None): vals.pop()
            if any(v not in ('',None) for v in vals): rows.append(vals)
        sheets.append({'name':sh.name,'rows':rows})
    return sheets

def csv_rows(data):
    text=None; enc='utf-8'
    for e in ('utf-8-sig','cp932','shift_jis'):
        try: text=data.decode(e); enc=e; break
        except UnicodeDecodeError: pass
    if text is None: text=data.decode('utf-8','replace'); enc='utf-8-replacement'
    return [{'name':'csv','encoding':enc,'rows':[row for row in csv.reader(io.StringIO(text)) if any(str(v).strip() for v in row)]}]

def tabular_payload(data,url):
    low=url.lower().split('?')[0]
    if low.endswith('.xlsx'): return xlsx_rows(data)
    if low.endswith('.xls'): return xls_rows(data)
    if low.endswith('.csv'): return csv_rows(data)
    if low.endswith('.zip'):
        out=[]
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            for name in z.namelist():
                if name.lower().endswith('.csv'):
                    for s in csv_rows(z.read(name)): out.append({'name':name+':'+s['name'],'rows':s['rows']})
        return out
    raise RuntimeError('unsupported_attachment')

for i,ref in enumerate(selected,1):
    try:
        data=download(ref['url']); digest=hashlib.sha256(data).hexdigest(); sheets=tabular_payload(data,ref['url'])
        payload={'schemaVersion':1,'sourceId':'mlit-japan-fuel-economy','sourceUrl':ref['url'],'title':ref.get('text'),'sha256':digest,'bytes':len(data),'sheets':sheets}
        name=f'{i:04d}-{digest[:16]}.json'; (OUT/name).write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n','utf-8')
        manifest['converted']+=1; manifest['files'].append({'file':'mlit/tabular-json/'+name,'sourceUrl':ref['url'],'title':ref.get('text'),'bytes':len(data),'sha256':digest,'sheets':len(sheets),'rows':sum(len(s.get('rows',[])) for s in sheets)})
    except Exception as e:
        manifest['failed']+=1; manifest['status']='partial'; manifest['errors'].append({'url':ref.get('url'),'title':ref.get('text'),'error':str(e)})
    time.sleep(0.10)
(MLIT/'tabular-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n','utf-8')
print(json.dumps(manifest,ensure_ascii=False,indent=2))
if manifest['converted']==0: raise SystemExit('mlit_tabular_zero')
