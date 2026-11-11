"""Read public catalog navigation and factual technical table cells only."""
import json,re,sys,urllib.request,urllib.parse,urllib.robotparser
from html.parser import HTMLParser
BASE='https://www.drom.ru'
AGENT='AvtoCenaTechnicalReference/1.0 (+https://avtocena.com)'
def accepted(url):
 p=urllib.parse.urlsplit(url)
 return p.scheme=='https' and p.netloc=='www.drom.ru' and not p.query and not p.fragment and bool(re.fullmatch(r'/catalog/(?:[a-z0-9_-]+/){0,2}(?:(?:\d+|g_\d+_\d+)/)?',p.path))
class Tables(HTMLParser):
 def __init__(self):
  super().__init__();self.links=set();self.row=None;self.cell=None;self.facts={};self.title='';self.in_title=False
 def handle_starttag(self,tag,attrs):
  if tag=='a':
   url=urllib.parse.urljoin(BASE,dict(attrs).get('href',''))
   if accepted(url):self.links.add(url)
  if tag=='h1':self.in_title=True
  if tag=='tr':self.row=[]
  if tag in ('td','th') and self.row is not None:self.cell=''
 def handle_data(self,data):
  if self.cell is not None:self.cell+=data
  if self.in_title:self.title+=data
 def handle_endtag(self,tag):
  if tag=='h1':self.in_title=False
  if tag in ('td','th') and self.cell is not None:
   if self.row is not None:self.row.append(' '.join(self.cell.split()))
   self.cell=None
  if tag=='tr' and self.row is not None:
   if len(self.row)==2:
    label,value=self.row
    if 0<len(label)<=160 and 0<len(value)<=500 and re.search(r'комплектац|период выпуска|двигател|мощност|привод|кузов|трансмисс|топлив|батаре|мотор|масса|вес|размер|габарит|база|коле[яи]|клиренс|двер|мест|скорост|разгон|цилиндр|клапан|крутящ|степень сжатия|нагнетател|систем.*питан|расход|бак|подвеск|тормоз|шин|диск|30.?мин',label,re.I):self.facts[label]=value
   self.row=None
class Redirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):
  if not accepted(newurl):raise ValueError('redirect_outside_catalog')
  return super().redirect_request(req,fp,code,msg,headers,newurl)
def fetch(url):
 if not accepted(url):raise ValueError('unsupported_reference_url')
 robots=urllib.robotparser.RobotFileParser(BASE+'/robots.txt');robots.read()
 if not robots.can_fetch(AGENT,url):raise ValueError('robots_disallow')
 req=urllib.request.Request(url,headers={'User-Agent':AGENT})
 with urllib.request.build_opener(Redirect()).open(req,timeout=25) as response:
  raw=response.read(3000001)
  if len(raw)>3000000:raise ValueError('page_too_large')
  charset=response.headers.get_content_charset() or ('windows-1251' if re.search(br'charset=["\s]*windows-1251',raw[:10000],re.I) else 'utf-8')
  html=raw.decode(charset,errors='strict')
 parser=Tables();parser.feed(html)
 period=parser.facts.get('Период выпуска','');years=[int(x)for x in re.findall(r'\b(?:19|20)\d{2}\b',period)]
 eligible=bool(years) and (len(years)<2 or max(years)>=2008)
 return {'url':url,'title':' '.join(parser.title.split())[:300],'links':sorted(parser.links),'facts':parser.facts if eligible else {},'period':period,'eligibleSince2008':eligible,'sourceKind':'technical_reference','verification':'unverified_reference'}
if __name__=='__main__':
 try: print(json.dumps(fetch(sys.argv[1]),ensure_ascii=False))
 except Exception as error:
  print(json.dumps({'error':type(error).__name__,'detail':str(error)[:300]}));sys.exit(1)
