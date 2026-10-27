#!/usr/bin/env python3
"""Mandatory one-shot release acceptance, not a scheduled collector.
Run on the VM: network/proxy latency from the audit environment is excluded.
"""
import argparse,json,time,urllib.request
from html.parser import HTMLParser

# Raising these ceilings requires the owner's explicit approval and before/after
# evidence. Cold preparation is separate and cannot count as a passing sample.
ROUTES=[
 ('/api/health',0.25,'health'),
 ('/',2.0,'html'),('/login',1.0,'html'),('/autocalc',1.0,'html'),
 ('/cars',2.0,'catalog'),('/cars?market=china&make=Volkswagen&page=2',2.0,'catalog'),
 ('/cars?market=china&city=%D0%9D%D0%BE%D0%B2%D0%BE%D0%BA%D1%83%D0%B7%D0%BD%D0%B5%D1%86%D0%BA',2.0,'catalog'),
 ('/cars?market=europe&make=BMW&page=2',2.0,'catalog'),
 ('/cars?sort=totalRub',2.0,'catalog'),
 ('/api/catalog/search?market=europe&make=BMW&page=2',1.0,'search'),
 ('/cars/autocatalog',2.0,'encyclopedia'),
]

# Cover both short selections and the five-minute directory refresh.
PHASE_DELAYS=[('warm',0),('after_ttl',35),('after_directory_ttl',305)]

class CatalogCards(HTMLParser):
 def __init__(self):
  super().__init__();self.in_card=False;self.has_link=False;self.count=0
 def handle_starttag(self,tag,attrs):
  attrs=dict(attrs)
  if tag=='article':
   self.in_card=bool({'ac-catalog-card','ac-catalog-list-row'} & set(attrs.get('class','').split()));self.has_link=False
  if self.in_card and tag=='a' and attrs.get('href','').startswith('/cars/offer/'):
   self.has_link=True
 def handle_endtag(self,tag):
  if tag=='article':
   if self.in_card and self.has_link:self.count+=1
   self.in_card=False;self.has_link=False

class EncyclopediaRows(HTMLParser):
 def __init__(self):super().__init__();self.count=0
 def handle_starttag(self,tag,attrs):
  if tag=='article' and 'ac-model-list-item' in dict(attrs).get('class','').split():self.count+=1

def validate(path,kind,status,body,release):
 if status!=200:raise AssertionError('performance_http:'+path+':'+str(status))
 if kind in ('html','catalog','encyclopedia'):
  if b'</html>' not in body or b'$RX(' in body:raise AssertionError('performance_incomplete_html:'+path)
  if kind=='encyclopedia':
   rows=EncyclopediaRows();rows.feed(body.decode('utf8','replace'))
   if not 1<=rows.count<=40:raise AssertionError('performance_invalid_encyclopedia:'+path)
  if kind=='catalog':
   cards=CatalogCards();cards.feed(body.decode('utf8','replace'))
   if not cards.count:raise AssertionError('performance_empty_catalog:'+path)
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
 for phase,delay in PHASE_DELAYS:
  if delay:time.sleep(delay)
  for path,limit,kind in ROUTES:
   elapsed=sample(args.base,path,kind,args.release)
   print(json.dumps({'performanceGate':phase,'path':path,'seconds':round(elapsed,4),'ceiling':limit,'passed':elapsed<=limit}),flush=True)
   if elapsed>limit:raise AssertionError('performance_budget_exceeded:'+path)
if __name__=='__main__':main()
