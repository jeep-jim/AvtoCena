#!/usr/bin/env python3
"""Read-only VM observations after release acceptance; no latency verdict or cache claim."""
import argparse, datetime, json, pathlib, re, signal, time, urllib.error, urllib.request
from html.parser import HTMLParser

ROUTES = ('/privacy', '/blog', '/dealers')
PHASES = (('first_observation', 0), ('warm_repeat', 0), ('after_35s_wait', 35), ('after_65s_wait', 65))
MAX_BODY_BYTES = 20 * 1024 * 1024
REQUEST_SECONDS = 15
TOTAL_SECONDS = 240

class DiagnosticFailure(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise DiagnosticFailure('unexpected_redirect')

OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

class Content(HTMLParser):
    VOID = {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
    HIDDEN = {'head','script','style','template'}
    def __init__(self):
        super().__init__()
        self.in_h1 = False
        self.html_closed, self.hidden_depth, self.visible_text = False, 0, []
        self.headings, self.heading = [], ''
        self.h2 = 0
        self.blog_links, self.dealer_links, self.links = set(), [], set()
        self.status_depth, self.status_text, self.statuses = 0, '', []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if self.hidden_depth:
            if tag not in self.VOID: self.hidden_depth += 1
            return
        if tag in self.HIDDEN:
            self.hidden_depth = 1
            return
        if tag == 'h1': self.in_h1, self.heading = True, ''
        if tag == 'h2': self.h2 += 1
        if tag == 'a':
            href = attrs.get('href', '')
            self.links.add(href)
            if re.fullmatch(r'/blog/[^/?#]+', href): self.blog_links.add(href)
            if 'dealer-directory-card' in attrs.get('class', '').split(): self.dealer_links.append(href)
        if self.status_depth:
            if tag not in self.VOID: self.status_depth += 1
        elif attrs.get('role') == 'status' and tag not in self.VOID: self.status_depth, self.status_text = 1, ''
    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID: self.handle_endtag(tag)
    def handle_endtag(self, tag):
        if tag in self.VOID: return
        if self.hidden_depth:
            self.hidden_depth -= 1
            return
        if tag == 'html': self.html_closed = True
        if tag == 'h1' and self.in_h1:
            self.headings.append(' '.join(self.heading.split())); self.in_h1 = False
        if self.status_depth:
            self.status_depth -= 1
            if not self.status_depth: self.statuses.append(' '.join(self.status_text.split()))
    def handle_data(self, value):
        if self.hidden_depth: return
        self.visible_text.append(value)
        if self.in_h1: self.heading += value
        if self.status_depth: self.status_text += value

def validate_page(path, status, body):
    if status != 200: raise DiagnosticFailure('http_status')
    if len(body) > MAX_BODY_BYTES: raise DiagnosticFailure('response_too_large')
    if b'</html>' not in body.lower() or b'$RX(' in body: raise DiagnosticFailure('incomplete_html')
    text = body.decode('utf-8', 'strict')
    parsed = Content(); parsed.feed(text)
    if not parsed.html_closed or parsed.cdata_elem or parsed.rawdata.strip() or parsed.hidden_depth:
        raise DiagnosticFailure('incomplete_html')
    heading = {'/privacy': 'Политика обработки персональных данных', '/blog': 'Автоблог', '/dealers': 'Автодилеры'}[path]
    if parsed.headings != [heading]: raise DiagnosticFailure('wrong_page_heading')
    counts = {}
    if path == '/privacy' and (not parsed.h2 or '/privacy/request' not in parsed.links):
        raise DiagnosticFailure('privacy_content_missing')
    if path == '/blog':
        if not parsed.blog_links and 'Первые материалы готовятся к публикации.' not in ' '.join(parsed.visible_text):
            raise DiagnosticFailure('blog_content_missing')
        counts['articleLinks'] = len(parsed.blog_links)
    if path == '/dealers':
        found = [re.fullmatch(r'Компаний:\s*(\d+)', value) for value in parsed.statuses]
        declared = [int(match[1]) for match in found if match]
        if len(declared) != 1 or declared[0] != len(parsed.dealer_links) or len(set(parsed.dealer_links)) != len(parsed.dealer_links):
            raise DiagnosticFailure('dealer_count_mismatch')
        if any(not link.startswith('/') or link.startswith('//') for link in parsed.dealer_links):
            raise DiagnosticFailure('dealer_link_invalid')
        counts['dealerCards'] = declared[0]
    return counts

def fetch_body(base, path, deadline):
    remaining = min(REQUEST_SECONDS, deadline - time.monotonic())
    if remaining <= 0: raise DiagnosticFailure('total_deadline')
    def expired(*_): raise DiagnosticFailure('response_deadline')
    previous = signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, remaining)
    start = time.monotonic()
    try:
        request = urllib.request.Request(base + path, headers={'User-Agent': 'AvtoCena-readonly-public-pages/1.0', 'Connection': 'close'})
        with OPENER.open(request, timeout=remaining) as response:
            headers_seconds = time.monotonic() - start
            body = response.read(MAX_BODY_BYTES + 1)
            if len(body) > MAX_BODY_BYTES: raise DiagnosticFailure('response_too_large')
            return response.status, body, headers_seconds, time.monotonic() - start
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)

def collect(base, release, fetch=fetch_body, clock=time.monotonic, sleep=time.sleep, calculation_version=None):
    if not re.fullmatch(r'http://127\.0\.0\.1:(3000|3001)', base) or not re.fullmatch(r'[a-f0-9]{40}', release) or (calculation_version is not None and not re.fullmatch(r'[a-f0-9]{64}', calculation_version)):
        raise DiagnosticFailure('invalid_scope')
    report = {'schemaVersion': 1, 'release': release, 'routes': list(ROUTES), 'samples': [], 'functionalPassed': False,
              'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'observationsOnly': True, 'performanceCeilingsApplied': False,
              'firstObservationIsColdProof': False, 'waitsProveCacheExpiry': False}
    deadline = clock() + TOTAL_SECONDS
    def health():
        status, body, _, _ = fetch(base, '/api/health', deadline)
        value = json.loads(body)
        if status != 200 or value.get('ok') is not True or value.get('releaseSha') != release:
            raise DiagnosticFailure('release_mismatch')
        if calculation_version is not None and value.get('calculationVersion') != calculation_version:
            raise DiagnosticFailure('calculation_version_mismatch')
        return {'ok': True, 'releaseSha': release, **({'calculationVersion': calculation_version} if calculation_version else {})}
    try:
        report['healthBefore'] = health()
        for phase, seconds in PHASES:
            target = clock() + seconds
            if target >= deadline: raise DiagnosticFailure('total_deadline')
            while clock() < target: sleep(min(30, max(0, target - clock())))
            for path in ROUTES:
                sample = {'phase': phase, 'path': path, 'functionalPassed': False}
                report['samples'].append(sample)
                started = clock()
                try:
                    status, body, first, complete = fetch(base, path, deadline)
                except Exception:
                    sample['observedSeconds'] = round(clock() - started, 4)
                    raise
                sample.update(status=status, bytes=len(body), headersSeconds=round(first, 4), completeSeconds=round(complete, 4))
                sample.update(validate_page(path, status, body), functionalPassed=True)
        report['functionalPassed'] = True
    except Exception as error:
        # Never include body fragments, exception messages or private data in evidence.
        report['errorCode'] = error.code if isinstance(error, DiagnosticFailure) else type(error).__name__
    if report.get('healthBefore') and report.get('errorCode') != 'interrupted':
        try:
            report['healthAfter'] = health()
        except Exception as error:
            report['functionalPassed'] = False
            report['healthAfterError'] = error.code if isinstance(error, DiagnosticFailure) else type(error).__name__
    report['finishedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    return report

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('base'); parser.add_argument('release'); parser.add_argument('output')
    parser.add_argument('--calculation-version')
    args = parser.parse_args()
    def interrupted(*_): raise DiagnosticFailure('interrupted')
    signal.signal(signal.SIGTERM, interrupted); signal.signal(signal.SIGINT, interrupted)
    report = collect(args.base, args.release, calculation_version=args.calculation_version)
    pathlib.Path(args.output).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'release': args.release, 'samples': len(report['samples']), 'functionalPassed': report['functionalPassed'], 'errorCode': report.get('errorCode')}))
    return 0 if report['functionalPassed'] else 1

if __name__ == '__main__': raise SystemExit(main())
