import urllib.request, urllib.parse, time, json, sys, signal
origin=sys.argv.pop(1)
expected=sys.argv.pop(1)
def deadline(*_):raise TimeoutError("response_deadline")
signal.signal(signal.SIGALRM,deadline)
def health():
 with urllib.request.urlopen(origin+"/api/health",timeout=10) as r:
  value=json.load(r)
 assert value.get("releaseSha")==expected, "release_mismatch"
health()
from html.parser import HTMLParser
class Cards(HTMLParser):
 def __init__(self):super().__init__();self.in_card=False;self.href=None;self.links=set();self.h1=False;self.heading=''
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag=='article':self.in_card=bool({'ac-catalog-card','ac-catalog-list-row'}&set(a.get('class','').split()))
  if self.in_card and tag=='a' and a.get('href','').startswith('/cars/offer/'):self.links.add(a['href'])
  if tag=='h1':self.h1=True
 def handle_endtag(self,tag):
  if tag=='article':self.in_card=False
  if tag=='h1':self.h1=False
 def handle_data(self,s):
  if self.h1:self.heading+=s
paths=sys.argv[1:] or ['/cars','/cars/china/BMW/3?powerTo=160&sort=totalRub','/cars/china/BMW/3%20SERIES?powerTo=160&sort=totalRub','/cars/europe']
for path in paths:
 signal.alarm(50);start=time.monotonic();parser=Cards();body=b'';first=None;status=None
 try:
  req=urllib.request.Request(origin+path,headers={'User-Agent':'Mozilla/5.0 AvtoCenaOwnerVerification','Accept':'text/html'})
  with urllib.request.urlopen(req,timeout=60) as response:
   status=response.status;headers_at=time.monotonic()-start
   import codecs
   decoder=codecs.getincrementaldecoder('utf-8')('replace')
   while part:=response.read1(16384):
    body+=part;parser.feed(decoder.decode(part))
    if parser.links and first is None:first=time.monotonic()-start
   parser.feed(decoder.decode(b'',final=True))
  text=body.decode('utf8','replace')
  result={'path':path,'http':status,'headersSeconds':round(headers_at,3),'firstCardsSeconds':round(first,3) if first is not None else None,'completeSeconds':round(time.monotonic()-start,3),'cards':len(parser.links),'heading':parser.heading,'error':('Не удалось загрузить автомобили' in text or '$RX(' in text),'complete':b'</html>' in body}
 except Exception as e:result={'path':path,'http':status,'seconds':round(time.monotonic()-start,3),'error':type(e).__name__,'cards':len(parser.links)}
 signal.alarm(0)
 print(json.dumps(result,ensure_ascii=False),flush=True)

health()
