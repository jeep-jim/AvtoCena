"""Read-only public Japan catalog collection; never publishes to production."""
import collections, datetime as dt, hashlib, html, json, os, pathlib, re, sys, time
import urllib.request, urllib.error, urllib.parse
from html.parser import HTMLParser

UA = 'AvtoCena catalog research/1.0'

class Page(HTMLParser):
    def __init__(self, markup):
        super().__init__(convert_charrefs=True)
        self.tags=[]
        self.feed(markup)
    def handle_starttag(self, tag, attrs):
        self.tags.append((tag,dict(attrs)))

def normalize_url(url):
    return urllib.parse.quote(url, safe=":/?&=%#@+;,!~*'()[]$-_.")

def clean(s):
    s=re.sub(r'<(script|style)\b[^>]*>[\s\S]*?</\1>', ' ', s, flags=re.I)
    return re.sub(r'\s+',' ',html.unescape(re.sub('<[^>]+>',' ',s))).strip()

def field(markup,label):
    m=re.search(re.escape(label)+r'\s*:?\s*<span\b[^>]*>([\s\S]*?)</span>',markup,re.I)
    return clean(m[1]) if m else ''

def number(s):
    m=re.search(r'\d[\d\s,]*(?:\.\d+)?',s)
    return float(re.sub(r'[\s,]','',m[0])) if m else None

def parse(markup,url,source):
    p=Page(markup)
    text=clean(markup)
    gallery=list(dict.fromkeys(a['href'] for tag,a in p.tags if tag=='a' and a.get('data-fancybox')=='gallery' and a.get('href','').startswith('https://')))
    sheets=list(dict.fromkeys(a.get('href') or a.get('src') for tag,a in p.tags if a.get('data-fancybox')=='gallery2' or 'Аукционный лист' in a.get('alt','')))
    if source=='tokai':
        section=markup.split('>Аукционный лист</h2>')
        if len(section)>1:
            m=re.search(r'<img\b[^>]*src=["\']([^"\']+)',section[1])
            if m:sheets.append(html.unescape(m[1]))
    gallery=[u for u in gallery if u not in sheets]
    if source=='jptrade':
        status=field(markup,'Статус')
        price=number(field(markup,'Последняя ставка'))
        date=field(markup,'Дата')
        year=number(field(markup,'Год'))
        title=re.search(r'<h2[^>]*>([^<]+)</h2>',markup)
        attrs=next((a for _,a in p.tags if a.get('data-marka') and a.get('data-model')), {})
        make,model=attrs.get('data-marka'),attrs.get('data-model')
        venue,lot=field(markup,'Аукцион'),field(markup,'Лот')
        cc=number(field(markup,'Объем')); mileage=number(field(markup,'Пробег'))
        grade=field(markup,'Оценка'); chassis=field(markup,'Кузов')
    else:
        status='' # Statistics placement alone is not an explicit sold status.
        m=re.search(r'Цена в Японии\s*([\d\s,]+)\s*¥',text)
        price=number(m[1]) if m else None
        m=re.search(r'Дата:\s*(\d{2}\.\d{2}\.\d{4})',text);date=m[1] if m else ''
        m=re.search(r'Год:\s*(\d{4})',text);year=int(m[1]) if m else None
        title=re.search(r'<h1[^>]*>([\s\S]*?)</h1>',markup)
        make=model=None
        m=re.search(r'Аукцион:\s*(.*?)\s*Дата:',text);venue=m[1] if m else ''
        m=re.search(r'лот(?:а)?\s*№\s*(\d+)',text,re.I);lot=m[1] if m else ''
        cc=mileage=None;grade=chassis=''
    iso=''
    try:iso=dt.datetime.strptime(date.replace('.','-'),'%d-%m-%Y').date().isoformat()
    except ValueError:pass
    if not title and not price:return None
    return dict(source=source,sourceUrl=url,sourceId=urllib.parse.urlsplit(url).path.rstrip('/').split('/')[-1] if source=='jptrade' else urllib.parse.parse_qs(urllib.parse.urlsplit(url).query).get('auc_id',[''])[0],
        title=clean(title[1]) if title else '',make=make,model=model,year=year,priceJpy=price,statusRaw=status,
        auctionDate=iso,auctionName=venue,lotNumber=lot,engineCc=cc,mileageKm=mileage,grade=grade,chassis=chassis,
        imageUrls=gallery,auctionSheetUrls=sheets,imagesVerified=False,publicationReady=False,
        evidenceSha256=hashlib.sha256(markup.encode()).hexdigest())

def eligible(row,today=None):
    today=today or dt.date.today()
    return bool(row and row['statusRaw'].lower()=='продано' and (row['priceJpy'] or 0)>0
        and (row['year'] or 0)>=2010 and row['auctionDate']
        and (today-dt.timedelta(days=92)).isoformat()<=row['auctionDate']<=today.isoformat()
        and len(row['imageUrls'])>=2 and row['make'] and row['model'])

def main(source):
    base={'jptrade':'https://jptrade.ru','tokai':'https://tokai-auto.ru'}[source]
    start=base+('/stat/' if source=='jptrade' else '/statistika/')
    root=pathlib.Path('japan-free-results')/source;root.mkdir(parents=True,exist_ok=True)
    deadline=time.monotonic()+int(os.getenv('SWEEP_SECONDS','10800'))
    pending=collections.deque([start]);queued={start};visited=set();identities=set();buffer=[];part=0
    report=dict(source=source,startedAt=dt.datetime.now(dt.timezone.utc).isoformat(),pages=0,details=0,accepted=0,review=0,duplicates=0,errors=[],stopReason='')
    if (root/'checkpoint.json').exists():
        checkpoint=json.loads((root/'checkpoint.json').read_text())
        old=json.loads((root/'summary.json').read_text())
        report.update(old)
        report['stopReason']=''
        report['resumedAt']=dt.datetime.now(dt.timezone.utc).isoformat()
        visited={normalize_url(u) for u in checkpoint['visited']}
        retry=[e['url'] for e in old.get('errors',[]) if "control characters" in e.get('error','')]
        pending=collections.deque(dict.fromkeys(normalize_url(u) for u in retry+checkpoint['pending'] if normalize_url(u) not in visited))
        queued=set(pending)|visited
        for saved in root.glob('part-*.json'):
            part=max(part,int(saved.stem.split('-')[1]))
            for row in json.loads(saved.read_text()):identities.add((source,row['sourceId']))
    def save():
        nonlocal part,buffer
        if buffer:
            part+=1;(root/f'part-{part:06d}.json').write_text(json.dumps(buffer,ensure_ascii=False));buffer=[]
        (root/'checkpoint.json').write_text(json.dumps(dict(pending=list(pending),visited=list(visited)),ensure_ascii=False))
        (root/'summary.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    failures=0
    try:
        while pending and time.monotonic()<deadline:
            url=normalize_url(pending.popleft())
            if url in visited:continue
            time.sleep(0.75)
            try:
                req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'text/html'})
                with urllib.request.urlopen(req,timeout=30) as response:
                    markup=response.read(3000000).decode('utf-8','replace')
                failures=0
            except Exception as e:
                failures+=1
                report['errors'].append(dict(url=url,error=str(e)))
                if isinstance(e,urllib.error.HTTPError) and e.code in (401,403,429):
                    pending.appendleft(url);report['stopReason']='access_or_rate_limit';break
                if failures>=5:pending.appendleft(url);report['stopReason']='consecutive_transport_errors';break
                continue
            visited.add(url);report['pages']+=1
            detail=bool(re.search(r'/stat/\d+',url)) if source=='jptrade' else 'auc_id=' in url
            if detail:
                report['details']+=1
                row=parse(markup,url,source)
                if row:
                    key=(source,row['sourceId'])
                    if key in identities:report['duplicates']+=1
                    else:
                        identities.add(key);row['qualifiedSoldCandidate']=eligible(row)
                        report['accepted' if row['qualifiedSoldCandidate'] else 'review']+=1
                        buffer.append(row)
            for tag,a in Page(markup).tags:
                link=a.get('href') if tag=='a' else a.get('data-href')
                if not link:continue
                target=normalize_url(urllib.parse.urljoin(url,link).split('#')[0])
                u=urllib.parse.urlsplit(target)
                if u.netloc!=urllib.parse.urlsplit(base).netloc:continue
                if source=='jptrade':allowed=u.path.startswith('/stat/')
                else:
                    allowed=('auc_id=' in u.query or u.path.startswith('/statistika/') or bool(re.fullmatch(r'/[a-z0-9-]+(?:/[a-z0-9-]+)?/',u.path)))
                    allowed=allowed and not re.search(r'/torgi/|/contacts/|/reviews/|/news/|/china/|/uslugi/|/informaciya/',u.path)
                if allowed and target not in queued:
                    queued.add(target);pending.append(target)
            if len(buffer)>=250 or report['pages']%25==0:
                save();print(json.dumps(report,ensure_ascii=False),flush=True)
        report['stopReason']=report['stopReason'] or ('time_budget_checkpointed' if pending else 'discovered_links_exhausted')
    finally:
        report['pending']=len(pending);report['finishedAt']=dt.datetime.now(dt.timezone.utc).isoformat();save();print(json.dumps(report,ensure_ascii=False),flush=True)

if __name__=='__main__':main(sys.argv[1])
