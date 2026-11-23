"""Read real anonymous selection and model routes on the isolated web image."""
import json
import time
import urllib.request
from html.parser import HTMLParser
from urllib.parse import parse_qs, urlencode, urlsplit

ORIGIN = 'http://127.0.0.1:3107'
MARKETS = 'korea|uae|green'


class SelectionPage(HTMLParser):
    def __init__(self):
        super().__init__()
        self.offer_links = set()
        self.counts = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        count = attrs.get('data-catalog-result-count', '')
        if count and count.isdigit():
            self.counts.add(int(count))
        href = urlsplit(attrs.get('href') or '')
        if (tag == 'a' and not href.netloc and href.path.startswith('/cars/offer/')
                and parse_qs(href.query).get('dealer') == ['dealer_topavto']):
            self.offer_links.add(href.path)


def get(name, path, params):
    start = time.monotonic()
    url = ORIGIN + path + '?' + urlencode(params)
    with urllib.request.urlopen(url, timeout=75) as res:
        first_ms = round((time.monotonic() - start) * 1000)
        raw = res.read(8 * 1024**2 + 1)
        assert res.status == 200 and len(raw) <= 8 * 1024**2, name
    print(json.dumps(dict(probe=name, firstMs=first_ms,
                          completeMs=round((time.monotonic() - start) * 1000), bytes=len(raw))), flush=True)
    return raw


def main():
    selected = dict(market=MARKETS, powerTo=160)
    for attempt in range(2):
        page = SelectionPage()
        page.feed(get('dealer-selection-' + str(attempt + 1), '/dealers/dealer_topavto',
                      dict(selected, selection=1)).decode())
        assert len(page.offer_links) >= 3 and len(page.counts) == 1, 'missing selection cards or total'
        count = json.loads(get('dealer-count', '/api/catalog/search', dict(selected, countOnly=1)))
        assert count['ok'] and not count.get('countIncomplete') and count['total'] in page.counts
        assert count['total'] > 0 and set(count['marketCounts']) == set(MARKETS.split('|'))
        assert sum(count['marketCounts'].values()) == count['total']
        query = dict(market='korea', marketPage=1, make='Kia', model='Morning', yearFrom=2022, powerTo=160, page=1)
        result = json.loads(get('korea-model-year-power-' + str(attempt + 1), '/api/catalog/search', query))
        cars = result['items']
        assert result['ok'] and 0 < len(cars) <= min(24, result['total'])
        assert len({car['id'] for car in cars}) == len(cars)
        for car in cars:
            assert car['market'] == 'korea' and car['make'].casefold() == 'kia'
            assert 'morning' in car['model'].casefold() and car['year'] >= 2022
            assert 0 < car['powerHp'] <= 160
        print(json.dumps(dict(dealerOffers=len(page.offer_links), dealerCount=count['total'],
                              modelPageCars=len(cars), modelCount=result['total'])), flush=True)


if __name__ == '__main__':
    main()
