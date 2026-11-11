#!/usr/bin/env python3
"""Read reviewed MLIT Porsche sheets only; emit type-column evidence, never engines/classification ranges."""
import argparse,hashlib,json,pathlib,re,unicodedata
import openpyxl,xlrd
p=argparse.ArgumentParser();p.add_argument('--cache',required=True);p.add_argument('--output',required=True);a=p.parse_args()
files=['001474453.xls','001474456.xls','001741611.xls','001741613.xls','3.5.G_LD_import_WLTC.xlsx']
root=pathlib.Path(a.cache);evidence=[]
def norm(v):return unicodedata.normalize('NFKC',str(v or '')).strip()
for name in files:
 path=root/name;raw=path.read_bytes()
 if name.endswith('.xls'):
  ws=xlrd.open_workbook(file_contents=raw,formatting_info=True).sheet_by_name('ポルシェ')
  rows=[ws.row_values(r) for r in range(ws.nrows)];merged=ws.merged_cells
 else:
  wb=openpyxl.load_workbook(path,data_only=True);ws=wb['ポルシェ'];rows=[list(r) for r in ws.values]
  merged=[(r.min_row-1,r.max_row,r.min_col-1,r.max_col) for r in ws.merged_cells.ranges]
 for lo,hi,left,right in merged:
  value=rows[lo][left]
  for r in range(lo,hi):
   for c in range(left,right):rows[r][c]=value
 # D is 型式 in each of these five inspected factory submissions. The engine
 # has a different 型式 column; category ranges may also look like xx-yy.
 assert any(norm(row[3])=='型式' for row in rows[:9]),name
 dc={c for row in rows[:9] for c,v in enumerate(row) if '駆動' in re.sub(r'\s','',str(v))}
 assert len(dc)==1,(name,dc)
 for r,row in enumerate(rows):
  full=norm(row[3]).upper();ds={norm(row[c]).upper() for c in dc}&{'F','R','A'}
  if not re.fullmatch(r'(?:ABA|DAA|3BA)-[A-Z0-9]+',full):continue
  assert len(ds)==1,(name,r+1,full)
  evidence.append(dict(brand='Porsche',code=full.split('-',1)[1],fullCode=full,drive={'F':'fwd','R':'rwd','A':'awd'}[next(iter(ds))],sheet='ポルシェ',row=r+1,column=4,driveColumns=[c+1 for c in dc],identity=[norm(v) for v in row[:7]],url='https://www.mlit.go.jp/jidosha/content/'+name,sha256=hashlib.sha256(raw).hexdigest()))
pathlib.Path(a.output).write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'rows':len(evidence),'codes':len({r['code'] for r in evidence})}))
