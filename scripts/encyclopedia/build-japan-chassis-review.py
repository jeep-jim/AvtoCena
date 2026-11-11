#!/usr/bin/env python3
"""Prepare bounded review tables from locally inspected MLIT extraction checkpoints.
No network, storage writes, chassis guesses, or new canonical model identities.
"""
import argparse,collections,json,pathlib,re,unicodedata,hashlib
p=argparse.ArgumentParser();p.add_argument('--evidence',required=True);p.add_argument('--inventory',default='reports/japan-chassis');args=p.parse_args()
def norm(x):return re.sub('[^A-Z0-9]','',unicodedata.normalize('NFKD',str(x)).upper())
def base(x):return re.sub(r'^[A-Z0-9]{1,3}-','',str(x).upper())
brands={'トヨタ':'Toyota','レクサス':'Lexus','ニッサン':'Nissan','日産':'Nissan','ホンダ':'Honda','マツダ':'Mazda','三菱':'Mitsubishi','スバル':'Subaru','スズキ':'Suzuki','ダイハツ':'Daihatsu','いすゞ':'Isuzu','アウディ':'Audi','フォルクスワーゲン':'Volkswagen','ベンツ':'Mercedes Benz','メルセデスベンツ':'Mercedes Benz','メルセデス・ベンツ':'Mercedes Benz','ビーエムダブリュー':'BMW','ポルシェ':'Porsche','ボルボ':'Volvo','ジャガー':'Jaguar','ランドローバー':'Land Rover','ルノー':'Renault','フィアット':'Fiat','アルファロメオ':'Alfa Romeo','アルファ':'Alfa Romeo','プジョー':'Peugeot','シトロエン':'Citroen','ホンダ(タイ)':'Honda','ニッサンMT':'Nissan'}
alias={'NISSANMT':'NISSAN','HONDAOFTHAILAND':'HONDA'}
def brand(s):
 s=unicodedata.normalize('NFKC',s);k=norm(brands.get(s,s));return alias.get(k,k)
evidence=collections.defaultdict(list)
for file in sorted(pathlib.Path(args.evidence).glob('*.v3.json')):
 for e in json.load(open(file)).get('evidence',[]):
  if not re.fullmatch(r'[A-Z0-9]{1,3}-[A-Z0-9]+',e['fullCode']):continue
  evidence[(brand(e.get('brand',e['sheet'])),e['code'])].append(e)
supplement=pathlib.Path('docs/encyclopedia/japan-chassis-drive-2026-10-25/manufacturer-supplement.json')
if supplement.exists():
 for e in json.load(open(supplement)):evidence[(brand(e['brand']),e['code'])].append(e)
inv=pathlib.Path(args.inventory);groups=[r for f in sorted(inv.glob('codes-*.json')) for r in json.load(open(f))]
extra=pathlib.Path('docs/encyclopedia/japan-chassis-drive-2026-10-25/additional-factory-codes.json')
if extra.exists():groups+=json.load(open(extra))
out=pathlib.Path('docs/encyclopedia/japan-chassis-drive-2026-10-25');out.mkdir(parents=True,exist_ok=True)
rows=[]
for g in groups:
 lookup_make='MINI' if g['model'].upper()=='MINI' else brand(g['make'])
 es=evidence[(lookup_make,base(g['chassisCode']))]+(evidence[(brand(g['make']),base(g['chassisCode']))] if lookup_make=='MINI' else []);drives=sorted({e['drive'] for e in es})
 # Keep a row-addressed proof for each full homologation code and drive; all rows
 # participate in consensus before this evidence deduplication.
 proofs={}
 for e in es:proofs.setdefault((e['fullCode'],e['drive']),e)
 rows.append(dict(make=g['make'],model=g['model'],chassisCode=base(g['chassisCode']),originalChassisCode=g['chassisCode'],years=g['years'],drives=drives,status='confirmed' if len(drives)==1 else 'ambiguous' if drives else 'unresolved',evidence=list(proofs.values()),sourceRows=len(es)))
for i in range(0,len(rows),64):(out/f'part-{i//64:04}.json').write_text(json.dumps(rows[i:i+64],ensure_ascii=False,indent=2)+'\n')
# Runtime does not ship internal provenance; ambiguity is retained explicitly.
runtime=pathlib.Path('apps/web/lib/encyclopedia/japan-chassis-drive');runtime.mkdir(exist_ok=True)
unique={}
for r in rows:
 key=(norm(r['make']),r['chassisCode']);old=unique.get(key)
 if old:old['drives']=sorted(set(old['drives'])|set(r['drives']))
 else:unique[key]={k:r[k] for k in ['make','chassisCode','drives']}
compact=list(unique.values());imports=[];names=[]
for i in range(0,len(compact),64):
 n=f'p{i//64}';names.append('...'+n);imports.append(f"import {n} from './part-{i//64:04}.json';")
 (runtime/f'part-{i//64:04}.json').write_text(json.dumps(compact[i:i+64],ensure_ascii=False,separators=(',',':'))+'\n')
(runtime/'manifest.ts').write_text('\n'.join(imports)+"\nexport default ["+','.join(names)+"];\n")
labels={'fwd':'Передний','rwd':'Задний','awd':'Полный'}
md=['# Привод по кодам кузова — 25.10.2026','','Сохранённые коды и отдельно проверенные заводские типы Porsche. Заводской тип не означает наличие объявления в фиде. Несколько приводов у одного кода требуют дополнительного признака автомобиля; конфликты источников остаются неопределёнными.','','| Марка | Модель | Код кузова | Привод по источнику | Проверка |','|---|---|---|---|---|']
for r in rows:
 ds=', '.join(labels[d] for d in r['drives']) or 'Не подтверждён';e=(r['evidence'] or [None])[0];link=f"[Источник]({e['url']}), {e['sheet']}, строка {e['row']}" if e else 'Нужен другой источник'
 md.append(f"| {r['make']} | {r['model']} | {r['originalChassisCode']} | {ds} | {link} |")
(out/'table.md').write_text('\n'.join(md)+'\n')
print(collections.Counter(r['status'] for r in rows))
print('Unresolved:',[(r['make'],r['chassisCode']) for r in rows if not r['drives']])
