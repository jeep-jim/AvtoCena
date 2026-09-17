"""Bounded read-only checks of saved detail URLs, not a collector."""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.error
import urllib.request
from urllib.parse import urlparse
import importlib.util

spec = importlib.util.spec_from_file_location('qualifier', Path(__file__).with_name('qualify-saved-japan-packages.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class SameHostRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urlparse(newurl).hostname != urlparse(req.full_url).hostname or urlparse(newurl).scheme != 'https':
            raise ValueError('cross_host_redirect_rejected')
        return super().redirect_request(req, fp, code, msg, headers, newurl)

parser = argparse.ArgumentParser()
parser.add_argument('--input', required=True)
parser.add_argument('--source', choices=['sferacar', 'proauctions'], required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
rows, _, _ = module.read_rows(args.input)
output = Path(args.output) / args.source
output.mkdir(parents=True, exist_ok=True)
opener = urllib.request.build_opener(SameHostRedirect)
requests = []
for row in sorted(rows, key=lambda r: str(r['sourceId']))[:10]:
    url = row['sourceUrl']
    expected = {'sferacar': 'sferacar.ru', 'proauctions': 'demo.pro-auctions.ru'}[args.source]
    if urlparse(url).hostname != expected or urlparse(url).scheme != 'https':
        raise ValueError('unexpected_source_url')
    record = {'sourceId': row['sourceId'], 'url': url, 'status': None}
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'AvtoCena source evidence recheck/1.0'})
        with opener.open(request, timeout=15) as response:
            body = response.read(2000001)
            record.update(status=response.status, truncated=len(body)>2000000,
                          sha256=hashlib.sha256(body).hexdigest())
            (output / (str(row['sourceId']) + '.html')).write_bytes(body)
    except urllib.error.HTTPError as error:
        record.update(status=error.code, error=str(error))
    except Exception as error:
        record['error'] = str(error)
    requests.append(record)
    print(json.dumps(record), flush=True)
    # Stop after access refusal/rate limit or a network failure; no bypass/retry.
    if record['status'] in (401, 403, 429) or record['status'] is None:
        break
(output/'requests.json').write_text(json.dumps(requests, ensure_ascii=False, indent=2))
