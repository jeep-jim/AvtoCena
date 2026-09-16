"""Public ProAuctions statistics collector, research only."""
import concurrent.futures
import datetime as dt, hashlib, json, os, pathlib, re, time, urllib.request, urllib.error, urllib.parse
from bs4 import BeautifulSoup
BASE='https://demo.pro-auctions.ru'
def num(s):
    m=re.search(r'\d[\d\s]*',s or '')
    return int(re.sub(r'\s','',m[0])) if m else None
def parse(body,url):
    soup=BeautifulSoup(body,'html.parser')
    def text(selector):
        e=soup.select_one(selector);return e.get_text(' ',strip=True) if e else ''
    fields={}
    for e in soup.select('.car-info__item'):
        k=e.select_one('.car-info__label');v=e.select_one('.car-info__value')
        if k and v:fields[k.get_text(' ',strip=True)]=v.get_text(' ',strip=True)
    title=text('h1');meta=text('.car-meta')
    date=re.search(r'\d{2}\.\d{2}\.\d{4}',meta)
    date=dt.datetime.strptime(date[0],'%d.%m.%Y').date().isoformat() if date else ''
    crumbs=[e.get_text(' ',strip=True) for e in soup.select('.breadcrumbs__item [itemprop="name"]')]
    photos=list(dict.fromkeys(urllib.parse.urljoin(url,a['href']) for a in soup.select('a[data-fancybox="gallery"][href]')))
    sheets=list(dict.fromkeys(urllib.parse.urljoin(url,a['src']) for a in soup.select('.list-img img[src]') if '/auc_auto/' in a['src']))
    lot=re.search(r'Лот\s*(\d+)',title,re.I)
    row={'source':'proauctions','sourceId':url.rsplit('/',1)[-1].split('.')[0],'sourceUrl':url,'title':title,
      'make':crumbs[2] if len(crumbs)>3 else None,'model':crumbs[3] if len(crumbs)>4 else None,
      'year':num(fields.get('Год')),'priceJpy':num(text('.car-price-hero__src span')),
      'priceEvidence':text('.car-price-hero__src'),'averagePriceEvidence':text('.car-price'),
      'auctionDate':date,'auctionName':re.sub(r'\s*Торги.*','',meta).removeprefix('Аукцион ').strip(),
      'lotNumber':lot[1] if lot else '', 'engineCc':num(fields.get('Объем, см³')),
      'powerHp':num(fields.get('Мощность')),'mileageKm':num(fields.get('Пробег, км')),
      'grade':fields.get('Оценка'),'chassis':fields.get('Номер кузова'),'rawFields':fields,
      'imageUrls':photos,'auctionSheetUrls':sheets,'statusRaw':fields.get('Статус',''),
      'soldEvidence':'public_statistics_section','qualifiedSoldCandidate':False,
      'imagesVerified':False,'publicationReady':False,'evidenceSha256':hashlib.sha256(body.encode()).hexdigest()}
    cutoff=(dt.date.today()-dt.timedelta(days=92)).isoformat()
    row['statisticsCandidate']=bool(row['priceJpy'] and (row['year'] or 0)>=2010 and cutoff<=date<=dt.date.today().isoformat() and len(photos)>=2)
    row['reviewReason']='statistics_price_requires_sale_confirmation_and_image_verification'
    return row
def main():
    root=pathlib.Path('japan-proauctions-results');root.mkdir(exist_ok=True)
    deadline=time.monotonic()+int(os.getenv('SWEEP_SECONDS','10800'))
    pending=[];done=set();part=0;page=int(os.getenv("START_PAGE","1"));buffer=[]
    report={'source':'proauctions','pages':0,'details':0,'statisticsCandidates':0,'errors':[],'stopReason':''}
    cp=root/'checkpoint.json'
    if cp.exists():
        c=json.loads(cp.read_text());pending=c['pending'];done=set(c['done']);page=c['page'];part=c['part'];report=c['report'];report['stopReason']=''
    def save():
        nonlocal part,buffer
        if buffer:
            part+=1;(root/f'part-{part:06d}.json').write_text(json.dumps(buffer,ensure_ascii=False));buffer=[]
        cp.write_text(json.dumps({'pending':pending,'done':sorted(done),'page':page,'part':part,'report':report}))
        (root/'summary.json').write_text(json.dumps({**report,'pending':len(pending),'nextPage':page,'checkedAt':dt.datetime.now(dt.timezone.utc).isoformat()},ensure_ascii=False,indent=2))
    def get(url):
        time.sleep(1)
        with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'AvtoCena catalog research/1.0'}),timeout=30) as r:
            return r.read(3000000).decode('utf-8','replace')
    try:
        while time.monotonic()<deadline:
            if pending:
                batch=pending[:2]
                def fetch_one(url):
                    try:return url,get(url),None
                    except Exception as e:return url,None,str(e)
                with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                    for url,body,error in pool.map(fetch_one,batch):
                        if error:
                            report['errors'].append({'url':url,'error':error});report['stopReason']='request_error_checkpointed';continue
                        row=parse(body,url)
                        if not row['year'] or not row['title']:
                            report['stopReason']='unexpected_detail_markup';continue
                        pending.remove(url);done.add(url);buffer.append(row);report['details']+=1
                        report['statisticsCandidates']+=int(row['statisticsCandidate'])
                if report['stopReason']:break
            else:
                url=f'{BASE}/statistika/?page={page}'
                try:body=get(url)
                except Exception as e:
                    report['errors'].append({'url':url,'error':str(e)});report['stopReason']='request_error_checkpointed';break
                links=list(dict.fromkeys(urllib.parse.urljoin(BASE,a) for a in re.findall(r'href=["\\\'](/statistika/[^"\\\']+/\\d+\\.html)["\\\']',body)))
                report['pages']+=1
                pending=[u for u in links if u not in done]
                if not pending:report['stopReason']='no_new_detail_links';break
                page+=1
            if len(buffer)>=250 or report['details']%25==0:
                save();print(json.dumps({**report,'errors':len(report['errors']),'pending':len(pending)},ensure_ascii=False),flush=True)
        report['stopReason']=report['stopReason'] or 'time_budget_checkpointed'
    finally:save();print((root/'summary.json').read_text(),flush=True)
if __name__=='__main__':main()
