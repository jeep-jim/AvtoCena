"""Collect Sferacar public list rows with bounded parallelism; never publishes."""
import collections,concurrent.futures,datetime as dt,hashlib,json,pathlib,re,time,urllib.request,urllib.parse,urllib.error
from bs4 import BeautifulSoup
BASE='https://sferacar.ru'
def num(t):
    m=re.search(r'\d[\d\s]*',t or '')
    return int(re.sub(r'\s','',m[0])) if m else None
def parse(body,url):
    s=BeautifulSoup(body,'html.parser');rows=[]
    for c in s.select('.auction-card'):
        def txt(q):
            e=c.select_one(q);return e.get_text(' ',strip=True) if e else ''
        def meta(k):
            e=c.select_one('meta[itemprop="'+k+'"]');return e.get('content') if e else None
        a=c.select_one('a.auction-card__name[href]') or c.select_one('a.auction-card__pics[href]')
        if not a:continue
        detail=urllib.parse.urljoin(BASE,a['href']);m=re.search(r'auc_id=(\d+)',detail)
        if not m:continue
        fields={}
        for p in c.select('.auction-card__info p'):
            spans=p.find_all('span',recursive=False)
            if len(spans)>=2:fields[spans[0].get_text(' ',strip=True)]=spans[1].get_text(' ',strip=True)
        prices={}
        for p in c.select('.auction-price__item'):
            ps=p.find_all('p',recursive=False)
            if len(ps)>=2:prices[ps[0].get_text(' ',strip=True)]=ps[1].get_text(' ',strip=True)
        images=list(dict.fromkeys(urllib.parse.urljoin(BASE,e.get('data-src') or e.get('src')) for e in c.select('.card-images img') if e.get('data-src') or e.get('src')))
        row={'source':'sferacar','sourceId':m[1],'sourceUrl':detail,'listingUrl':url,'make':meta('brand'),'model':meta('model'),
          'year':num(meta('productionDate')),'auctionDate':txt('.card-auction__date'),'auctionName':txt('.card-auction__location'),'lotNumber':txt('.card-auction__num'),
          'priceJpy':num(prices.get('Финальная цена')),'startPriceJpy':num(prices.get('Начальная цена')),'priceEvidence':prices,
          'engineCc':num(fields.get('Объем двигателя')),'mileageKm':num(fields.get('Пробег')),'chassis':fields.get('Кузов'),'rawFields':fields,
          'grade':txt('.auction-card__rating'),'imageUrls':images,'statusRaw':'','publicationReady':False,'imagesVerified':False,
          'qualifiedSoldCandidate':False,'evidenceSha256':hashlib.sha256(str(c).encode()).hexdigest()}
        row['finalPriceCandidate']=bool((row['year'] or 0)>=2010 and (row['priceJpy'] or 0)>0 and len(images)>=2 and (dt.date.today()-dt.timedelta(days=92)).isoformat()<=row['auctionDate']<=dt.date.today().isoformat())
        rows.append(row)
    links=[]
    for a in s.select('a[href],a[data-url]'):
        u=urllib.parse.urlsplit(urllib.parse.urljoin(url,a.get('data-url') or a.get('href')))
        if u.netloc!='sferacar.ru' or u.path not in ('/auktsiony/','/statistika/'):continue
        page=urllib.parse.parse_qs(u.query).get('page',['1'])[0]
        if page.isdigit():links.append(BASE+u.path+'?page='+page)
    return rows,list(dict.fromkeys(links))
def main():
    root=pathlib.Path('japan-sferacar-results');root.mkdir(exist_ok=True)
    pending=collections.deque([BASE+'/auktsiony/?page=1',BASE+'/statistika/?page=1']);queued=set(pending);seen=set();rows={};buffer=[];part=0
    report={'pages':0,'records':0,'finalPriceCandidates':0,'duplicates':0,'errors':[],'stopReason':''}
    deadline=time.monotonic()+10800
    def save():
        nonlocal buffer,part
        if buffer:
            part+=1;(root/f'part-{part:06d}.json').write_text(json.dumps(buffer,ensure_ascii=False));buffer=[]
        (root/'checkpoint.json').write_text(json.dumps({'pending':list(pending),'visited':sorted(seen),'ids':sorted(rows)}))
        (root/'summary.json').write_text(json.dumps({**report,'pending':len(pending),'publicationReady':False},ensure_ascii=False,indent=2))
    def fetch(url):
        time.sleep(1)
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'AvtoCena catalog research/1.0'}),timeout=30) as r:
                body=r.read(4000000).decode('utf-8','replace')
            return url,parse(body,url),None
        except Exception as e:return url,None,{'error':str(e),'code':getattr(e,'code',None)}
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            while pending and time.monotonic()<deadline and not report['stopReason']:
                batch=[pending.popleft() for _ in range(min(2,len(pending)))]
                for url,data,error in pool.map(fetch,batch):
                    if error:
                        report['errors'].append({'url':url,**error});pending.append(url)
                        report['stopReason']='access_or_rate_limit' if error['code'] in (401,403,429) else 'request_error_checkpointed'
                        continue
                    found,links=data;seen.add(url);report['pages']+=1
                    for r in found:
                        if r['sourceId'] in rows:report['duplicates']+=1;continue
                        rows[r['sourceId']]=True;buffer.append(r);report['records']+=1;report['finalPriceCandidates']+=int(r['finalPriceCandidate'])
                    for link in links:
                        if link not in queued:queued.add(link);pending.append(link)
                if len(buffer)>=250 or report['pages']%10<2:
                    save();print(json.dumps(report,ensure_ascii=False),flush=True)
        report['stopReason']=report['stopReason'] or ('time_budget_checkpointed' if pending else 'public_pagination_exhausted')
    finally:save();print((root/'summary.json').read_text(),flush=True)
if __name__=='__main__':main()
