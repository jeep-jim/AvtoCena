"""One explicitly triggered, bounded public verification; no production writes."""
import codecs
import datetime
import json
import pathlib
import signal
import time
import urllib.error
import urllib.request
from html.parser import HTMLParser

marker = json.loads(pathlib.Path('.github/market-runs/owner-search-recovery-verify.json').read_text())
expected = marker['release']
origin = 'https://avtocena.com'
report = {'expectedRelease': expected, 'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'measurementEnvironment': 'GitHub Actions public verification runner',
          'timingMeaning': 'External network measurements: first linked card received in HTML, not browser paint.',
          'checks': []}


class Cards(HTMLParser):
    def __init__(self):
        super().__init__()
        self.card = False
        self.links = set()
        self.h1 = False
        self.heading = ''

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'article':
            self.card = bool({'ac-catalog-card', 'ac-catalog-list-row'} & set(attrs.get('class', '').split()))
        if self.card and tag == 'a' and attrs.get('href', '').startswith('/cars/offer/'):
            self.links.add(attrs['href'])
        if tag == 'h1':
            self.h1 = True

    def handle_endtag(self, tag):
        if tag == 'article':
            self.card = False
        if tag == 'h1':
            self.h1 = False

    def handle_data(self, data):
        if self.h1:
            self.heading += data


def deadline(*_):
    raise TimeoutError('complete_response_deadline')


signal.signal(signal.SIGALRM, deadline)


def request(path, agent='Mozilla/5.0 AvtoCenaOwnerVerification', html=False):
    start = time.monotonic()
    parser = Cards()
    decoder = codecs.getincrementaldecoder('utf-8')('replace')
    first = None
    body = bytearray()
    result = {'path': path, 'agent': agent}
    signal.alarm(60 if html else 25)
    try:
        req = urllib.request.Request(origin + path, headers={'User-Agent': agent, 'Connection': 'close'})
        try:
            response = urllib.request.urlopen(req, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            result.update(http=response.status, headersSeconds=round(time.monotonic() - start, 3))
            while chunk := response.read1(16384):
                body.extend(chunk)
                if len(body) > 8_000_000:
                    raise ValueError('response_size_limit')
                if html:
                    parser.feed(decoder.decode(chunk))
                    if parser.links and first is None:
                        first = round(time.monotonic() - start, 3)
        result['completeSeconds'] = round(time.monotonic() - start, 3)
        if html:
            parser.feed(decoder.decode(b'', final=True))
            text = body.decode('utf-8', 'replace')
            result.update(cards=len(parser.links), firstCardsSeconds=first, heading=parser.heading,
                          complete='</html>' in text,
                          errorStream='$RX(' in text or 'Не удалось загрузить автомобили' in text,
                          latencyTargetMiss=result['completeSeconds'] > 2)
        return result, bytes(body)
    except Exception as error:
        result.update(error=type(error).__name__ + ':' + str(error), completeSeconds=round(time.monotonic() - start, 3))
        if html:
            result.update(cards=len(parser.links), firstCardsSeconds=first, heading=parser.heading, complete=False)
        return result, b''
    finally:
        signal.alarm(0)


def health(label, agent='Mozilla/5.0 AvtoCenaOwnerVerification'):
    result, body = request('/api/health', agent)
    result['label'] = label
    try:
        data = json.loads(body)
        result.update(release=data.get('releaseSha'), passed=result.get('http') == 200 and data.get('ok') is True and data.get('releaseSha') == expected)
    except Exception:
        result['passed'] = False
    report['checks'].append(result)
    return result['passed']


if health('before'):
    for path in ['/cars', '/cars/china/BMW/3?powerTo=160&sort=totalRub',
                 '/cars/china/BMW/3%20SERIES?powerTo=160&sort=totalRub', '/cars/europe']:
        result, _ = request(path, html=True)
        result['passed'] = (result.get('http') == 200 and result.get('complete') and result.get('cards', 0) > 0
                            and not result.get('errorStream') and not result.get('error')
                            and '%20' not in result.get('heading', ''))
        report['checks'].append(result)
        print(json.dumps(result, ensure_ascii=False), flush=True)
    result, body = request('/api/catalog/models?scope=inventory&make=BMW&market=china')
    try:
        data = json.loads(body)
        names = [row[1] for row in data.get('models', [])]
        result.update(models=len(names), bmw3=any(str(name).lower() in {'3', '3 series'} for name in names))
        result['passed'] = result.get('http') == 200 and result['bmw3']
    except Exception:
        result['passed'] = False
    report['checks'].append(result)
    for agent in ['Amazonbot/0.1', 'ReflectionBot/1.0']:
        result, _ = request('/cars', agent)
        result['passed'] = result.get('http') == 403
        report['checks'].append(result)
    health('google-retained', 'Googlebot/2.1')
    health('yandex-retained', 'YandexBot/3.0')
    health('after')
report['passed'] = len(report['checks']) == 11 and all(row.get('passed') for row in report['checks'])
pathlib.Path('owner-search-recovery-public.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False), flush=True)
raise SystemExit(0 if report['passed'] else 1)
