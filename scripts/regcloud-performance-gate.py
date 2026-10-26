#!/usr/bin/env python3
"""Mandatory one-shot release acceptance, not a scheduled collector.
Run on the VM: network/proxy latency from the audit environment is excluded.
"""
import argparse,json,time,urllib.request

# Raising these ceilings requires the owner's explicit approval and before/after
# evidence. Cold preparation is separate and cannot count as a passing sample.
ROUTES=[
 ('/api/health',0.25,'health'),
 ('/',2.0,'html'),('/login',1.0,'html'),('/autocalc',1.0,'html'),
 ('/cars',2.0,'html'),('/cars?market=china&make=Volkswagen&page=2',2.0,'html'),
 ('/cars?market=europe&make=BMW&page=2',2.0,'html'),
 ('/cars?sort=totalRub',2.0,'html'),
 ('/api/catalog/search?market=europe&make=BMW&page=2',1.0,'search'),
]

def validate(path,kind,status,body,release):
 if status!=200:raise AssertionError('performance_http:'+path+':'+str(status))
 if kind=='html':
  if b'</html>' not in body or b'$RX(' in body:raise AssertionError('performance_incomplete_html:'+path)
 else:
  value=json.loads(body)
  if kind=='health':
   if not value.get('ok') or value.get('releaseSha')!=release:raise AssertionError('performance_wrong_release')
  elif not value.get('items') or not value.get('total',0)>0:raise AssertionError('performance_empty_search')

def sample(base,path,kind,release):
 start=time.monotonic()
 req=urllib.request.Request(base+path,headers={'User-Agent':'AvtoCena-release-acceptance/1.0','Connection':'close'})
 with urllib.request.urlopen(req,timeout=15) as response:
  body=response.read(20*1024*1024+1);status=response.status
 elapsed=time.monotonic()-start
 if len(body)>20*1024*1024:raise AssertionError('performance_response_too_large:'+path)
 validate(path,kind,status,body,release)
 return elapsed

def main():
 parser=argparse.ArgumentParser();parser.add_argument('base');parser.add_argument('release');args=parser.parse_args()
 # Explicit preparation, then measurements. No swallowed timeouts/empty states.
 for path,limit,kind in ROUTES:sample(args.base,path,kind,args.release)
 for phase in ['warm','after_ttl']:
  if phase=='after_ttl':time.sleep(35)
  for path,limit,kind in ROUTES:
   elapsed=sample(args.base,path,kind,args.release)
   print(json.dumps({'performanceGate':phase,'path':path,'seconds':round(elapsed,4),'ceiling':limit,'passed':elapsed<=limit}),flush=True)
   if elapsed>limit:raise AssertionError('performance_budget_exceeded:'+path)
if __name__=='__main__':main()
