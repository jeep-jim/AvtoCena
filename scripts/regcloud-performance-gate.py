#!/usr/bin/env python3
"""Mandatory functional release acceptance with advisory speed measurements.
Run on the VM: network/proxy latency from the audit environment is excluded.
"""
import argparse,json,time,urllib.request,urllib.error,os,urllib.parse,ipaddress
from html.parser import HTMLParser

# Owner decision 28.10.2026: speed targets are advisory, never a rollback trigger.
# Keep raw evidence and all routes; slow does not mean performance accepted.
# A bounded network deadline still detects unavailable/hung responses.
REQUEST_TIMEOUT_SECONDS=90
ROUTES=[
 ('/api/health',0.25,'health'),
 # Empty POST must reach consent validation without creating a customer or lead.
 ('/api/leads',1.0,'lead_validation'),
 ('/',2.0,'html'),('/login',1.0,'html'),('/autocalc',1.0,'html'),
 ('/cars',2.0,'catalog'),('/cars?market=china&make=Volkswagen&page=2',2.0,'catalog'),
 ('/cars?market=china&city=%D0%9D%D0%BE%D0%B2%D0%BE%D0%BA%D1%83%D0%B7%D0%BD%D0%B5%D1%86%D0%BA',2.0,'catalog'),
 ('/cars/china/BMW/3%20SERIES?powerTo=160&sort=totalRub&city=%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0',2.0,'catalog'),
 ('/cars?market=europe&make=BMW&page=2',2.0,'catalog'),
 ('/cars?sort=totalRub',2.0,'catalog'),
 ('/api/catalog/search?market=europe&make=BMW&page=2',1.0,'search'),
 # Page nine is the first page beyond the 192-card prepared category landing.
 ('/api/catalog/search?market=china&marketPage=1&page=9',1.0,'search'),
 ('/cars/autocatalog',2.0,'encyclopedia'),
 ('/cars/autocatalog?make=Changan',2.0,'encyclopedia'),
]

MARKETS=('china','korea','japan','europe','uae','georgia')
def route_market(path):
 parsed=urllib.parse.urlsplit(path)
 segments=parsed.path.split('/')
 if len(segments)>2 and segments[1]=='cars' and segments[2] in MARKETS:return segments[2]
 return urllib.parse.parse_qs(parsed.query).get('market',[''])[0]

# Owner instruction 31.10.2026: a targeted market release must not depend on
# another market's availability. Full releases keep their original route set.
def release_routes(scope='',require_home=False):
 routes=list(ROUTES)
 if scope:
  markets=scope.split(',')
  if len(markets)!=len(set(markets)) or any(m not in MARKETS for m in markets):
   raise ValueError('release_market_scope_invalid')
  common=[r for r in ROUTES if r[2]=='encyclopedia' or r[0] in ['/api/health','/api/leads','/login','/autocalc','/cars/autocatalog']]
  selected=[r for r in ROUTES if route_market(r[0]) in markets]
  for market in markets:
   route=('/cars?market='+market,2.0,'catalog')
   if route not in selected:selected.append(route)
  routes=common+selected
 if require_home:
  # Only explicit homepage releases add global acceptance to a market scope.
  routes=[(path,limit,'home_catalog' if path=='/' else kind) for path,limit,kind in routes]
  if not any(path=='/' for path,_,_ in routes):routes.append(('/',2.0,'home_catalog'))
  routes.append(('/api/catalog/home',1.0,'home_snapshot'))
 return routes

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
 def __init__(self):super().__init__();self.count=0;self.brands=0;self.brand_text=False;self.in_brand=False
 def handle_starttag(self,tag,attrs):
  attrs=dict(attrs);classes=attrs.get('class','').split()
  if tag=='article' and 'ac-model-list-item' in classes:self.count+=1
  if tag=='button' and 'ac-brand-card' in classes:
   self.in_brand='disabled' not in attrs;self.brand_text=False
 def handle_data(self,data):
  if self.in_brand and data.strip():self.brand_text=True
 def handle_endtag(self,tag):
  if tag=='button':
   if self.in_brand and self.brand_text:self.brands+=1
   self.in_brand=False

def validate(path,kind,status,body,release):
 if kind=='lead_validation':
  if status!=400 or json.loads(body).get('error')!='personal_data_consent_required':raise AssertionError('release_lead_intake_unavailable')
  return
 if status!=200:raise AssertionError('performance_http:'+path+':'+str(status))
 if kind in ('html','catalog','encyclopedia','home_catalog'):
  if b'</html>' not in body or b'$RX(' in body:raise AssertionError('performance_incomplete_html:'+path)
  if kind=='encyclopedia':
   rows=EncyclopediaRows();rows.feed(body.decode('utf8','replace'))
   selected=bool(urllib.parse.parse_qs(urllib.parse.urlsplit(path).query).get('make'))
   valid=1<=rows.count<=40 if selected else rows.brands>0 and rows.count==0
   if not valid:raise AssertionError('performance_invalid_encyclopedia:'+path)
  if kind in ('catalog','home_catalog'):
   cards=CatalogCards();cards.feed(body.decode('utf8','replace'))
   if not cards.count:raise AssertionError('performance_empty_catalog:'+path)
   if kind=='home_catalog' and 'Не удалось загрузить каталог'.encode('utf8') in body:
    raise AssertionError('performance_home_catalog_unavailable')
 else:
  value=json.loads(body)
  if kind=='health':
   if not value.get('ok') or value.get('releaseSha')!=release:raise AssertionError('performance_wrong_release')
  elif kind=='home_snapshot':
   valid_count=lambda count:type(count) is int and 0<=count<=9007199254740991
   if not isinstance(value,dict) or value.get('error') or value.get('failed') or value.get('ok') is False:
    raise AssertionError('performance_home_snapshot_unavailable')
   items=value.get('items');counts=value.get('marketCounts');total=value.get('total');generation=value.get('generationId')
   if not isinstance(generation,str) or not generation.strip() or not isinstance(items,list) or not items:
    raise AssertionError('performance_home_snapshot_empty')
   if not valid_count(total) or total<=0 or not isinstance(value.get('countIncomplete'),bool):
    raise AssertionError('performance_home_snapshot_invalid_count')
   if not isinstance(counts,dict) or any(not valid_count(counts.get(market)) for market in MARKETS) or any(not valid_count(count) for count in counts.values()) or sum(counts.values())>total:
    raise AssertionError('performance_home_snapshot_invalid_count')
   for item in items:
    if not isinstance(item,dict) or not isinstance(item.get('id'),str) or not item['id'] or item.get('market') not in MARKETS:
     raise AssertionError('performance_home_snapshot_invalid_item')
   if any(sum(item['market']==market for item in items)>counts[market] for market in MARKETS):
    raise AssertionError('performance_home_snapshot_invalid_count')
  elif not value.get('items') or not value.get('total',0)>0:raise AssertionError('performance_empty_search')

def probe_headers(base,path,kind):
 headers={'User-Agent':'AvtoCena-release-acceptance/1.0','Connection':'close','Content-Type':'application/json','Origin':'https://avtocena.com'}
 market=route_market(path)
 if kind=='catalog' and market in ('korea','japan'):
  # SSH is the authenticated proxy for this runner-initiated candidate visit.
  # Use only its observed TCP peer, never a chosen/server/borrowed address.
  if urllib.parse.urlsplit(base).hostname not in ('127.0.0.1','::1'):
   return headers # Public nginx supplies the real network peer itself.
  connection=os.environ.get('SSH_CONNECTION','').split()
  if len(connection)!=4:raise AssertionError('release_probe_ssh_peer_missing')
  try:peer=ipaddress.ip_address(connection[0])
  except ValueError:raise AssertionError('release_probe_ssh_peer_invalid')
  if not peer.is_global:raise AssertionError('release_probe_ssh_peer_not_public')
  headers['X-Real-IP']=str(peer)
 return headers

def sample(base,path,kind,release):
 start=time.monotonic()
 req=urllib.request.Request(base+path,data=b'{}' if kind=='lead_validation' else None,headers=probe_headers(base,path,kind))
 try:
  response=urllib.request.urlopen(req,timeout=REQUEST_TIMEOUT_SECONDS)
 except urllib.error.HTTPError as error:
  if kind!='lead_validation':raise
  response=error
 with response:
  body=response.read(20*1024*1024+1);status=response.status
 elapsed=time.monotonic()-start
 if len(body)>20*1024*1024:raise AssertionError('performance_response_too_large:'+path)
 validate(path,kind,status,body,release)
 return elapsed

def sample_with_context(base,path,kind,release,stage):
 # Initial preparation used to fail without identifying its route. Report only
 # the configured public path and exception metadata; never log response bodies,
 # headers, full request URLs or exception messages that may contain private data.
 try:
  return sample(base,path,kind,release)
 except Exception as error:
  status=error.code if isinstance(error,urllib.error.HTTPError) else None
  print(json.dumps({'performanceGate':'failure','stage':stage,'path':path,'kind':kind,
   'status':status,'error':type(error).__name__,'functionalPassed':False}),flush=True)
  raise

def main():
 parser=argparse.ArgumentParser();parser.add_argument('base');parser.add_argument('release');args=parser.parse_args()
 # Explicit preparation, then measurements. No swallowed timeouts/empty states.
 home_flag=os.environ.get('AVTOCENA_RELEASE_REQUIRE_HOME_CATALOG','0')
 if home_flag not in ('0','1'):raise ValueError('release_home_catalog_flag_invalid')
 routes=release_routes(os.environ.get('AVTOCENA_RELEASE_MARKETS',''),home_flag=='1')
 for path,limit,kind in routes:sample_with_context(args.base,path,kind,args.release,'preparation')
 slow=0
 for phase,delay in PHASE_DELAYS:
  if delay:time.sleep(delay)
  for path,limit,kind in routes:
   elapsed=sample_with_context(args.base,path,kind,args.release,phase)
   print(json.dumps({'performanceGate':phase,'path':path,'seconds':round(elapsed,4),'ceiling':limit,'passed':elapsed<=limit,'functionalPassed':True,'latencyBlocking':False}),flush=True)
   if elapsed>limit:
    slow+=1
    print('::warning::Slow response (advisory): '+phase+' '+path+' '+str(round(elapsed,4))+'s; target '+str(limit)+'s. Functional checks passed.',flush=True)
 print(json.dumps({'performanceGate':'summary','marketScope':os.environ.get('AVTOCENA_RELEASE_MARKETS','all'),'requireHomeCatalog':home_flag=='1','routes':[r[0] for r in routes],'samples':len(routes)*len(PHASE_DELAYS),'slowSamples':slow,'functionalPassed':True,'performanceAccepted':slow==0,'latencyBlocking':False}),flush=True)
if __name__=='__main__':main()
