"""No network or output rows. Check imported exact UAE ZIPs and replay archived canonical input."""
import collections
import hashlib
import json
from pathlib import Path
import sys
import zipfile

S='dubicars_uae_exact'
A=(
 (14287441994,41512678,'becb2ffeea1b50b00810a4d62e24e0a139128ae095b414d18b79b19e6cd760eb',
  '43988535521','d0dbf889b139b6d489ddf781fbad1f6bf86f1a6c','ff7d930aec5ee8b059e28ef06e0ccc6afadd88b89d45df38917f85b44bd966a3',320508,320763,27433),
 (14586057004,5449527,'7841b7f8473bbfd6c40bc8ad65dd065e2f1f40575bc7585de54b2c24b0ea75e2',
  '44636630094','15f51970fb68555ad56b7c40f622517a15643377','96ad148930615ee2c317235e46d41bd988f306e112c373ada744eb36e559f054',320763,324989,0))
def check(x):
 if not x: raise ValueError('archive_scope_or_checksum_mismatch')
def digest(x):return hashlib.sha256(x).hexdigest()
def lines(z,ns):
 for n in ns:
  with z.open(n) as f:
   while b:=f.readline(8*1024*1024+1):
    check(len(b)<=8*1024*1024 and b.endswith(b'\n'))
    yield json.loads(b)

def replay(d, spec, stock):
 aid,size,sha,run,rev,manifest,cursor,end,nbase=spec
 path=d/f'{aid}.zip'
 check(path.stat().st_size==size)
 with path.open('rb') as f:check(hashlib.file_digest(f,'sha256').hexdigest()==sha)
 with zipfile.ZipFile(path) as z:
  names=z.namelist()
  check(len(names)==len(set(names)) and all('/' not in n for n in names) and sum(i.file_size for i in z.infolist())<300*1024*1024)
  r=json.loads(z.read('own-storage-receipt.json')); raw=z.read('report.json'); report=json.loads(raw)
  check(r['market']=='uae' and r['root']==f'catalog/nonjp-intake/v1/uae/{run}/1' and r['manifestSha256']==manifest
    and r['owner']['runId']==run and r['owner']['attempt']=='1' and r['owner']['revision']==rev and r['reportDigest']==digest(raw))
  check(report['completed'] is True and report['productionWrites'] is False and report['requiredSourceIds']==[S])
  events=[]; terminal=False; membership=[]
  for rr in lines(z,sorted(n for n in names if n.startswith('raw-'+S+'-'))):
   check(not terminal and rr['provider']=='auto_api_dubicars' and rr['kind']=='provider_response')
   e=rr['endpoint']; p=rr['payload']
   if e=='offers':
    check(nbase>0);membership.extend(str(o['inner_id']) for o in p['result'])
   elif e=='changes':
    check(rr['params']['change_id']==p['meta']['cur_change_id']==cursor)
    page=p['result']
    if not page:check(cursor==end);terminal=True;continue
    nxt=p['meta']['next_change_id'];check(cursor<nxt<=end and [v['id'] for v in page]==list(range(cursor,nxt)))
    events.extend((str(v['inner_id']),v['change_type']) for v in page);cursor=nxt
   else: check(e in ('offer','change_id'))
  check(terminal and len(membership)==nbase and len(set(membership))==nbase)
  normalize=lines(z,sorted(n for n in names if n.startswith(S+'-')))
  def one(x):
   o=x['offer'];check(x['stage']=='detail' and o['market']=='uae' and o['sourceId']==S and o['status']=='active')
   return str(o['sourceOfferId']),o
  for key in membership:
   actual,o=one(next(normalize));check(key==actual);stock[key]=o
  details=dict(one(v) for v in normalize)
  seen=set(stock)
  for k,kind in events:
   if kind=='removed':check(k in seen);seen.remove(k)
   elif kind=='changed':check(k in seen)
   else:check(kind=='added');seen.add(k)
  for k,kind in dict(events).items():
   if kind=='removed':stock.pop(k,None)
   else:stock[k]=details[k]
  check(seen==set(stock))
  return report['completedAt'],cursor

def main():
 stock={}
 for a in A:asof,cursor=replay(Path(sys.argv[1]),a,stock)
 digest_stream=hashlib.sha256()
 for k in sorted(stock):digest_stream.update(json.dumps(stock[k],ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()+b'\n')
 expected='990edf60121625b1426b96ff8660bf7d953157cc0fbcec8ef35a6ede3e1c83f6'
 check(len(stock)==27581 and digest_stream.hexdigest()==expected and cursor==324989)
 print(json.dumps({'scope':'archived_paid_dubicars_only','supplierRows':len(stock),'observedThrough':asof,'cursorObserved':cursor,
   'normalizedRowDigest':expected,'supplierCalls':0,'remoteWrites':0,'currentStockVerified':False,'publicationAllowed':False},indent=2))
if __name__=='__main__':main()
