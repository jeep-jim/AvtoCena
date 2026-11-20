"""One anonymous public GET for each observation; at most one exact card redirect."""
import html, json, pathlib, re, subprocess, tempfile, urllib.parse

HOST = 'https://avtocena.com'
APP = '85296f6b8797aaa93227b69da7e9e9e928e8f9b5'
CALC = '4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90'
GEN = 'gen_1795166586455_china44710087159'
Q = {'market':'china','make':'BMW','model':'X3','sort':'totalRub','pageSize':'1'}
PRIMARY = ('ordinary-release','china-canonical','api-bmw-x3-list','api-bmw-x3-count',
           'ssr-bmw-x3-canonical','ssr-ordinary-same-card')
FOLLOW = 'ssr-same-card-canonical'
EGRESS = (5,6,7,28,35)

class Refused(Exception):
    pass

def emit(row):
    print(json.dumps(row,ensure_ascii=True,sort_keys=True),flush=True)

class Probe:
    def __init__(self,*,emit_row=emit,local_prices=False):
        self.sequence=[]
        self.emitted=0
        self.report={'schema':'china-ordinary-public-timing-v2','expectedGeneration':GEN,
                     'expectedRelease':APP,'sequence':self.sequence}
        self.emit_row=emit_row
        self.local_prices=local_prices

    def checkpoint(self):
        while self.emitted<len(self.sequence):
            row=self.sequence[self.emitted]
            self.emit_row({'kind':'china_public_timing_route_v2',**row})
            self.emitted+=1

    def one(self,root,label,path,bound,*,follow=None):
        n=len(self.sequence)
        if (not path.startswith('/') or path.startswith('//') or
            (label not in PRIMARY and label != FOLLOW)):
            raise Refused('route_outside_public_sample')
        if label==FOLLOW:
            # A seventh GET is permitted only for the exact same pinned card,
            # after the last primary GET produced a permitted canonical redirect.
            if (n!=len(PRIMARY) or self.sequence[-1]['route']!=PRIMARY[-1] or
                self.sequence[-1].get('httpStatus') not in (307,308) or
                follow is None or exact_link(path,*follow)!=path):
                raise Refused('invalid_exact_card_redirect')
        elif n>=len(PRIMARY) or PRIMARY[n]!=label:
            raise Refused('public_sample_budget_order')
        f=root/'body'; hdr=root/'headers'
        f.unlink(missing_ok=True); hdr.unlink(missing_ok=True)
        row={'route':label}; self.sequence.append(row)
        try:
            p=subprocess.run(['curl','--disable','--proto','=https','--silent','--show-error',
                '--connect-timeout','4','--max-time','10','--max-filesize',str(bound),
                '-H','Accept-Encoding: identity','-H','Connection: close','--dump-header',str(hdr),
                '-o',str(f),'-w','%{http_code} %{time_namelookup} %{time_connect} %{time_appconnect} %{time_starttransfer} %{time_total} %{size_download}',HOST+path],
                capture_output=True,text=True,timeout=12)
            try:
                code,dns,tcp,tls,ttfb,total,size=p.stdout.split()
                row.update(httpStatus=int(code),dnsS=float(dns),tcpS=float(tcp),tlsS=float(tls),ttfbS=float(ttfb),
                           fullOrStopS=float(total),bytes=int(size),curlExit=p.returncode)
            except ValueError:
                row.update(curlExit=p.returncode,metricsUnavailable=True)
            with hdr.open('rb') as stream:
                headers=stream.read(16384).splitlines()
        except subprocess.TimeoutExpired:
            row.update(transportFailure='client_guard_timeout',fullOrStopS=12)
            return row,b'',None
        except FileNotFoundError:
            if 'curlExit' not in row:
                row['transportFailure']='curl_unavailable'
                return row,b'',None
            headers=[]
        loc=next((b[9:].strip().decode('ascii','replace') for b in reversed(headers)
                  if len(b)<=2048 and b.lower().startswith(b'location:')),None)
        if not f.is_file():
            raw=b''
        else:
            with f.open('rb') as stream:
                raw=stream.read(bound+1)
            if len(raw)>bound:
                row['responseBoundExceeded']=True
                raw=b''
        return row,raw,loc

    def run(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d)
            health,raw,_=self.one(root,PRIMARY[0],'/api/health',8192)
            if health.get('curlExit')==0 and health.get('httpStatus')==200:
                try:
                    parsed=json.loads(raw)
                    health.update(healthOk=parsed.get('ok') is True,releaseMatches=parsed.get('releaseSha')==APP,
                                  protectedCalculatorMatches=parsed.get('calculationVersion')==CALC)
                except (AttributeError,ValueError,UnicodeError):
                    health['jsonValid']=False
            self.checkpoint()
            if not all(health.get(k) is True for k in ('healthOk','releaseMatches','protectedCalculatorMatches')):
                self.report['stopped']='egress_no_connection_on_release' if health.get('httpStatus')==0 and health.get('tcpS')==0 else 'exact_release_health_not_verified'
                return
            row,raw,_=self.one(root,PRIMARY[1],'/cars/china',5*1048576)
            annotate_html(row,raw); self.checkpoint()
            if row.get('httpStatus')==0 and row.get('tcpS')==0 and row.get('curlExit') in EGRESS:
                self.report['stopped']='egress_no_connection_on_storefront'
                return
            api='/api/catalog/search?'+urllib.parse.urlencode(Q)
            lr,raw,_=self.one(root,PRIMARY[2],api,1024*1024)
            li=payload(lr,raw); self.checkpoint()
            cr,raw,_=self.one(root,PRIMARY[3],api+'&countOnly=1',256*1024)
            payload(cr,raw); self.checkpoint()
            self.report['indexedCountParity']=bool(
                lr.get('httpStatus')==cr.get('httpStatus')==200 and lr.get('curlExit')==cr.get('curlExit')==0 and
                lr.get('ok') and cr.get('ok') and lr.get('generationMatches') and cr.get('generationMatches') and
                lr['total'] and lr['total']==cr['total'] and lr['rows']==1 and cr['rows']==0 and not cr['countIncomplete'])
            model='/cars/china/BMW/X3?'+urllib.parse.urlencode({'sort':'totalRub','pageSize':'1'})
            row,raw,_=self.one(root,PRIMARY[4],model,5*1048576)
            annotate_html(row,raw)
            items=li.get('items')
            if type(items) is not list or len(items)!=1 or type(items[0]) is not dict or not lr.get('generationMatches') or not lr.get('ok') or lr.get('curlExit')!=0:
                self.report['detailSkipped']='missing_current_generation_list_row'
                self.checkpoint(); return
            item=items[0]; cid=item.get('id'); price=item.get('totalRub'); binding=item.get('preparedChinaSelection')
            if (not isinstance(cid,str) or not re.fullmatch('[a-f0-9]{24}',cid) or item.get('market')!='china' or
                type(price) is not int or not 0<price<=10**9 or type(binding) is not dict or
                binding.get('generationId')!=GEN):
                self.report['detailSkipped']='list_row_not_exact_cut_and_price'
                self.checkpoint(); return
            city=binding.get('city')
            if city is not None and (not isinstance(city,str) or not 0<len(city)<=100 or not city.isprintable()):
                self.report['detailSkipped']='unexpected_list_row_city'
                self.checkpoint(); return
            links=(html.unescape(x.decode('utf-8','replace')) for x in re.findall(rb'href="([^"]+)"',raw))
            canonical=next((link for h in links if (link:=exact_link(h,cid,city))),None)
            row['pinnedListCardLink']=bool(canonical); self.checkpoint()
            path=canonical or '/cars/offer/'+cid+'?'+urllib.parse.urlencode(dict(card_params(city)))
            dr,raw,location=self.one(root,PRIMARY[5],path,4*1048576)
            if dr.get('curlExit')==0 and dr.get('httpStatus') in (307,308) and not canonical and location:
                canonical=exact_link(location,cid,city)
                if canonical:
                    dr['redirect']='exact_same_card_canonical'; self.checkpoint()
                    dr,raw,_=self.one(root,FOLLOW,canonical,4*1048576,follow=(cid,city))
                else:
                    dr['redirect']='refused_unpinned_target'
            annotate_html(dr,raw)
            matches=re.findall(rb'<main\b[^>]*\bdata-offer-id="'+cid.encode()+rb'"[^>]*>',raw)
            exact=re.search(rb'\bdata-offer-price-rub="([1-9][0-9]{0,9})"',matches[0]) if len(matches)==1 else None
            detail_price=int(exact[1]) if exact else None
            dr['exactPriceParity']=bool(healthy_html(dr) and detail_price==price)
            if self.local_prices:
                self.report['localPricesRub']={'api':price,'detail':detail_price}
            self.checkpoint()

    def finish(self):
        try:
            self.run()
        except Refused as e:
            self.report['stopped']=str(e)
        except (OSError, ValueError, TypeError):
            self.report['stopped']='bounded_probe_parse_or_io_error'
        except Exception:
            self.report['stopped']='unexpected_probe_error'
        finally:
            self.checkpoint()
            rows={row['route']:row for row in self.sequence}
            self.report['measurementComplete']=bool(self.report.get('indexedCountParity') and
                all(healthy_html(rows.get(r,{})) for r in (PRIMARY[1], PRIMARY[4])) and
                any(r.get('exactPriceParity') and healthy_html(r) for r in self.sequence))
            self.emit_row(self.report)
        return self.report['measurementComplete']

def annotate_html(row,raw):
    row.update(hasHtmlEnd=b'</html>' in raw,streamedErrorMarker=b'$RX(' in raw,
               softAppError=b'Application error: a server-side exception' in raw,
               complete=row.get('curlExit')==0 and row.get('httpStatus')==200 and b'</html>' in raw)

def healthy_html(row):
    return row.get('complete') and not row.get('streamedErrorMarker') and not row.get('softAppError')

def payload(row,raw):
    try: data=json.loads(raw)
    except (ValueError,UnicodeError,RecursionError): data=None
    if type(data) is not dict:
        row['jsonValid']=False
        return {}
    row['jsonValid']=True
    total=data.get('total'); items=data.get('items')
    row.update(ok=data.get('ok') is True,generationMatches=data.get('generationId')==GEN,
               total=total if type(total) is int and 0<=total<=10**8 else None,
               rows=len(items) if isinstance(items,list) else None,countIncomplete=data.get('countIncomplete') is True)
    return data

def card_params(city):
    return [('market','china'),('preparedCut',GEN)]+([('city',city)] if city is not None else [])

def exact_link(raw,cid,city=None):
    if len(raw)>2048 or not raw.isprintable():
        return None
    try:
        parts=urllib.parse.urlsplit(urllib.parse.urljoin(HOST,raw))
        pairs=urllib.parse.parse_qsl(parts.query,keep_blank_values=True,max_num_fields=3)
    except ValueError:
        return None
    if (parts.scheme!='https' or parts.netloc!='avtocena.com' or parts.fragment or
        not re.fullmatch('/cars/offer/'+cid+r'/[a-z0-9-]{1,160}',parts.path) or
        sorted(pairs)!=sorted(card_params(city))):
        return None
    return parts.path+'?'+parts.query

if __name__=='__main__':
    import os,sys
    if sys.argv[1:] not in ([],['--local-exact-price']):
        raise SystemExit(2)
    complete=Probe(local_prices=sys.argv[1:]==['--local-exact-price'] and not os.environ.get('GITHUB_ACTIONS')).finish()
    if not complete:
        raise SystemExit(2)
