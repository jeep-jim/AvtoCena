"""One sequential public GET per route (plus at most one same-card redirect).
Run from an authorized egress. No request auth, cookies, provider, or writes to site.
"""
import html, json, pathlib, re, subprocess, tempfile, urllib.parse
HOST = 'https://avtocena.com'
APP = "85296f6b8797aaa93227b69da7e9e9e928e8f9b5"
CALC = "4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90"
GEN = 'gen_1795166586455_china44710087159'
Q = {'market':'china','make':'BMW','model':'X3','sort':'totalRub','pageSize':'1'}
T = {'schema':'china-ordinary-public-timing-v1','expectedGeneration':GEN,'expectedRelease':APP,'sequence':[]}
FETCHES = 0

def one(root, label, path, bound):
    global FETCHES
    FETCHES += 1
    assert FETCHES <= 6 and path.startswith('/') and not path.startswith('//')
    f = root / 'body'
    hdr = root / 'headers'
    f.unlink(missing_ok=True); hdr.unlink(missing_ok=True)
    p = subprocess.run(['curl','--disable','--proto','=https','--silent','--show-error',
        '--connect-timeout','4','--max-time','10','--max-filesize',str(bound),
        '-H','Accept-Encoding: identity','-H','Connection: close','--dump-header',str(hdr),
        '-o',str(f),'-w','%{http_code} %{time_namelookup} %{time_connect} %{time_appconnect} %{time_starttransfer} %{time_total} %{size_download}', HOST+path],
        capture_output=True,text=True,timeout=12)
    try:
        code,dns,tcp,tls,ttfb,total,size=p.stdout.split()
        timing=dict(httpStatus=int(code),dnsS=float(dns),tcpS=float(tcp),tlsS=float(tls),ttfbS=float(ttfb),fullOrStopS=float(total),bytes=int(size),curlExit=p.returncode)
    except ValueError:
        timing=dict(curlExit=p.returncode,metricsUnavailable=True)
    T['sequence'].append(row:=dict(route=label,**timing))
    headers=hdr.read_bytes().splitlines() if hdr.is_file() else []
    loc=next((b[9:].strip().decode('ascii','replace') for b in reversed(headers) if b.lower().startswith(b'location:')),None)
    raw=f.read_bytes() if f.is_file() else b''
    f.unlink(missing_ok=True);hdr.unlink(missing_ok=True)
    return row,raw,loc

def annotate_html(row, raw):
    row.update(hasHtmlEnd=b'</html>' in raw,streamedErrorMarker=b'$RX(' in raw,
        softAppError=b'Application error: a server-side exception' in raw,
        complete=row.get('curlExit')==0 and row.get('httpStatus')==200 and b'</html>' in raw)

def payload(row,raw):
    try: data=json.loads(raw)
    except (ValueError, UnicodeError):
        row['jsonValid']=False
        return {}
    if type(data) is not dict:
        row['jsonValid']=False
        return {}
    row['jsonValid']=True
    total=data.get('total'); items=data.get('items')
    row.update(ok=data.get('ok') is True, generationMatches=data.get('generationId')==GEN,
        total=total if type(total) is int and 0 <= total <= 10**8 else None,
        rows=len(items) if isinstance(items,list) else None,
        countIncomplete=data.get('countIncomplete') is True)
    return data

def exact_link(src,cid):
    parts=urllib.parse.urlsplit(urllib.parse.urljoin(HOST,src))
    pairs=urllib.parse.parse_qsl(parts.query,keep_blank_values=True)
    if (parts.scheme!='https' or parts.netloc!='avtocena.com' or parts.fragment or
        not re.fullmatch('/cars/offer/'+cid+r'/[a-z0-9-]{1,160}',parts.path)
        or sorted(pairs)!=[('market','china'),('preparedCut',GEN)]): return None
    return parts.path+'?'+parts.query

def run(*, local_prices=False):
    with tempfile.TemporaryDirectory() as d:
        root=pathlib.Path(d)
        health,raw,_=one(root,'ordinary-release','/api/health',8192)
        if health.get('curlExit')==0 and health.get('httpStatus')==200:
            try:
                parsed=json.loads(raw)
                health.update(healthOk=parsed.get('ok') is True,releaseMatches=parsed.get('releaseSha')==APP,
                              protectedCalculatorMatches=parsed.get('calculationVersion')==CALC)
            except (AttributeError, ValueError, UnicodeError):
                health['jsonValid']=False
        if not all(health.get(k) is True for k in ('healthOk','releaseMatches','protectedCalculatorMatches')):
            T['stopped']='egress_no_connection_on_release' if health.get('httpStatus')==0 and health.get('tcpS')==0 else 'exact_release_health_not_verified'
            return
        row,raw,_=one(root,'china-canonical','/cars/china',5*1048576)
        annotate_html(row,raw)
        if row.get('httpStatus')==0 and row.get('tcpS')==0 and row.get('curlExit') in (5,6,7,28,35):
            T['stopped']='egress_no_connection_on_first_get'
            return
        query=urllib.parse.urlencode(Q)
        api='/api/catalog/search?'+query
        listrow,raw,_=one(root,'api-bmw-x3-list',api,1024*1024); li=payload(listrow,raw)
        countrow,raw,_=one(root,'api-bmw-x3-count',api+'&countOnly=1',256*1024); payload(countrow,raw)
        model='/cars/china/BMW/X3?'+urllib.parse.urlencode({'sort':'totalRub','pageSize':'1'})
        row,raw,_=one(root,'ssr-bmw-x3-canonical',model,5*1048576); annotate_html(row,raw)
        items=li.get('items')
        if type(items) is not list or len(items)!=1 or type(items[0]) is not dict or not listrow.get('generationMatches'):
            T['detailSkipped']='missing_current_generation_list_row'; return
        item=items[0]; cid=item.get('id'); price=item.get('totalRub'); binding=item.get('preparedChinaSelection')
        if (not isinstance(cid,str) or not re.fullmatch('[a-f0-9]{24}',cid) or item.get('market')!='china' or
            type(price) is not int or not 0<price<=10**9 or type(binding) is not dict or binding.get('generationId')!=GEN):
            T['detailSkipped']='list_row_not_exact_cut_and_price'; return
        strings=(html.unescape(x.decode('utf-8', 'replace')) for x in re.findall(rb'href="([^"]+)"',raw))
        canonical=next((l for x in strings if (l:=exact_link(x,cid))), None)
        row['pinnedListCardLink']=bool(canonical)
        path=canonical or ('/cars/offer/'+cid+'?'+urllib.parse.urlencode({'market':'china','preparedCut':GEN}))
        dr,raw,loc=one(root,'ssr-ordinary-same-card',path,4*1048576)
        if dr.get('httpStatus') in (307,308) and not canonical and loc and (canonical:=exact_link(loc,cid)):
            dr,raw,_=one(root,'ssr-same-card-canonical',canonical,4*1048576)
        annotate_html(dr,raw)
        mains=re.findall(rb'<main\b[^>]*\bdata-offer-id="'+cid.encode()+rb'"[^>]*>',raw)
        exact=re.search(rb'\bdata-offer-price-rub="([1-9][0-9]{0,9})"',mains[0]) if len(mains)==1 else None
        detail_price=int(exact[1]) if exact else None
        dr['exactPriceParity']=bool(dr['complete'] and not dr['streamedErrorMarker'] and detail_price==price)
        if local_prices:
            T['localPricesRub']={'api':price,'detail':detail_price}
        T['indexedCountParity']= bool(listrow.get('ok') and countrow.get('ok') and countrow.get('generationMatches') and
                      listrow['total'] and listrow['total']==countrow['total'] and countrow['rows']==0 and not countrow['countIncomplete'])

if __name__=='__main__':
    import os, sys
    if sys.argv[1:] not in ([], ['--local-exact-price']):
        raise SystemExit(2)
    run(local_prices=sys.argv[1:]==['--local-exact-price'] and not os.environ.get('GITHUB_ACTIONS'))
    html_routes={r['route']:r for r in T['sequence']}
    healthy=lambda r: r.get('complete') and not r.get('streamedErrorMarker') and not r.get('softAppError')
    T['measurementComplete']=bool(T.get('indexedCountParity') and all(healthy(html_routes.get(r,{})) for r in ('china-canonical','ssr-bmw-x3-canonical'))
      and any(r.get('exactPriceParity') and healthy(r) for r in T['sequence']))
    print(json.dumps(T,ensure_ascii=True,sort_keys=True))
    if not T['measurementComplete']:
        raise SystemExit(2)
