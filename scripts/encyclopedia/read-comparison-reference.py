"""Stage public technical tables; never promote comparison facts to verified specs."""
import json, re, sys, urllib.request, urllib.parse, urllib.robotparser
from html.parser import HTMLParser
BASE = 'https://auto.ru'
AGENT = 'AvtoCenaTechnicalReference/1.0 (+https://avtocena.com)'

def accepted(url):
    p = urllib.parse.urlsplit(url)
    return (p.scheme == 'https' and p.netloc == 'auto.ru' and not p.query and not p.fragment
            and bool(re.fullmatch(r'/catalog/cars/(?:[a-z0-9_-]+/){0,2}(?:\d+/){0,2}(?:specifications/)?', p.path)))

class Tables(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = set(); self.rows = []; self.row = None; self.cell = None
        self.heading = ''; self.body = ''; self.title = ''; self.capture = None; self.text = ''
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'a':
            url = urllib.parse.urljoin(BASE, attrs.get('href', ''))
            if accepted(url): self.links.add(url)
        if tag in ('h1', 'h2', 'h3') or (tag == 'span' and 'SpecificationContent__thumb_firstText' in attrs.get('class', '')):
            self.capture = tag; self.text = ''
        if tag == 'tr': self.row = []
        if tag in ('td', 'th') and self.row is not None: self.cell = ''
    def handle_data(self, data):
        if self.capture: self.text += data
        if self.cell is not None: self.cell += data
    def handle_endtag(self, tag):
        if tag == self.capture:
            text = ' '.join(self.text.split())[:300]
            if tag == 'h1': self.title = text
            elif tag == 'span': self.body = text
            else: self.heading = text; self.body = ''
            self.capture = None
        if tag in ('td', 'th') and self.cell is not None:
            if self.row is not None: self.row.append(' '.join(self.cell.split()))
            self.cell = None
        if tag == 'tr' and self.row is not None:
            cells = self.row
            # Only a fully identified dimensions row, never prose or unrelated tables.
            if (len(cells) == 4 and self.heading.startswith('Размеры') and self.body
                    and re.fullmatch(r'\d+ x \d+ x \d+', cells[1])
                    and cells[2].isdigit() and 0 < len(cells[0]) <= 150):
                years = [int(y) for y in re.findall(r'\b(?:19|20)\d{2}\b', self.heading)]
                if years and max(years) >= 2008:
                    self.rows.append({'generation': self.heading, 'body': self.body,
                        'variant': cells[0], 'dimensionsMm': [int(x) for x in cells[1].split(' x ')],
                        'sourceMassKg': int(cells[2]), 'massInterpretation': 'unspecified_do_not_use_as_gvw'})
            self.row = None

class Redirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not accepted(newurl): raise ValueError('redirect_outside_catalog')
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def fetch(url):
    if not accepted(url): raise ValueError('unsupported_reference_url')
    robots = urllib.robotparser.RobotFileParser()
    with urllib.request.urlopen(urllib.request.Request(BASE+'/robots.txt', headers={'User-Agent': AGENT}), timeout=20) as r:
        robots.parse(r.read(1000000).decode('utf-8').splitlines())
    if not robots.can_fetch(AGENT, url): raise ValueError('robots_disallow')
    with urllib.request.build_opener(Redirect()).open(urllib.request.Request(url, headers={'User-Agent': AGENT}), timeout=25) as r:
        raw = r.read(3000001)
        if len(raw) > 3000000: raise ValueError('page_too_large')
        html = raw.decode(r.headers.get_content_charset() or 'utf-8')
    p = Tables(); p.feed(html)
    if not p.links and not p.rows: raise ValueError('no_catalog_content_or_access_challenge')
    return {'url': url, 'title': p.title, 'links': sorted(p.links),
        'facts': {'dimensionsByVariant': p.rows} if p.rows else {},
        'sourceKind': 'technical_reference', 'verification': 'unverified_reference',
        'productionApplied': False}

if __name__ == '__main__':
    try: print(json.dumps(fetch(sys.argv[1]), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'error': type(error).__name__, 'detail': str(error)[:300]})); sys.exit(1)
