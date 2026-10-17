"""Prepare an inert copy of a real offer; keep the page's DOM, images and styles."""
import sys, re, json, base64, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
from urllib.parse import urljoin
from lxml import html, etree
source, output = sys.argv[1:3]
origin = 'https://avtocena.com'
root = html.parse(source).getroot()
root.set('data-theme', 'light')
for element in root.xpath('//script | //link[@rel="preload"] | //link[@rel="modulepreload"]'):
    element.getparent().remove(element)
links = root.xpath('//link[@rel="stylesheet"]')
def get_css(link):
    url = urljoin(origin, link.get('href'))
    cached = Path('/tmp/avtocena-css-' + hashlib.sha256(url.encode()).hexdigest())
    if not cached.exists(): cached.write_bytes(urllib.request.urlopen(url, timeout=30).read())
    return link, url, cached.read_text()
with ThreadPoolExecutor(max_workers=4) as pool:
    sheets = list(pool.map(get_css, links))
for link, url, css in sheets:
    css = re.sub(r'url\(([^)]+)\)', lambda m: 'url("' + urljoin(url, m[1].strip('\"\'')) + '")', css)
    style = etree.Element('style'); style.text = css
    link.getparent().replace(link, style)
for element in root.iter():
    for attr in ('src', 'href'):
        value = element.get(attr, '') or ''
        if value.startswith('/'): element.set(attr, urljoin(origin, value))
# Embed the actual photos and font files so the preview does not depend on hotlinks.
images = root.xpath('//img[@src]')
assets = {n.get('src') for n in images if n.get('src', '').startswith('https://')}
for st in root.xpath('//style'):
    assets.update(re.findall(r'url\("(https://[^"\)]+\.woff2?)"\)', st.text or ''))
def asset_data(url):
    cache = Path('/tmp/avtocena-asset-' + hashlib.sha256(url.encode()).hexdigest())
    if not cache.exists():
        with urllib.request.urlopen(url, timeout=25) as response:
            cache.write_bytes(response.read())
    mime = 'font/woff2' if '.woff2' in url else 'font/woff' if '.woff' in url else 'image/jpeg'
    return url, 'data:' + mime + ';base64,' + base64.b64encode(cache.read_bytes()).decode()
with ThreadPoolExecutor(max_workers=4) as pool:
    embedded = dict(pool.map(asset_data, sorted(assets)))
for n in images:
    if n.get('src') in embedded: n.set('src', embedded[n.get('src')])
for st in root.xpath('//style'):
    if st.text:
        for url, data in embedded.items():
            if url in st.text: st.text = st.text.replace(url, data)
# Original values remain unchanged. Only the two agreed positions are added.
gallery = root.xpath('//button[@aria-label="Открыть фотографии автомобиля"]')[0]
column = list(gallery.iterancestors())[3]
assert column.tag == 'div' and column.get('class') == 'min-w-0'
mount = etree.Element('div', id='specifications-desktop')
column.insert(2, mount)
body = root.xpath('//*[@aria-label="Кузов: Хэтчбек"]')[0]
stack = body.getparent().getparent()
assert 'ac-offer-spec-stack' in stack.get('class')
stack.append(etree.Element('div', id='specifications-mobile', attrib={'class':'xl:hidden'}))
gavel = root.xpath('//button[@aria-label="Что означает завершённый аукционный лот"]')[0]
gavel.getparent().replace(gavel, etree.Element('div', id='auction-badges'))
# Inert existing controls; the changed disclosure components are mounted separately.
for node in root.xpath('//input | //select | //textarea'):
    node.set('disabled','disabled')
style = etree.Element('style')
style.text = ''
root.find('head').append(style)
root.find('head').append(etree.Element('meta', name='robots', content='noindex,nofollow'))
assert len(root.xpath('//*[@id="specifications-desktop"]')) == 1
assert len(root.xpath('//*[@id="specifications-mobile"]')) == 1
open(output,'w').write(html.tostring(root,encoding='unicode',doctype='<!doctype html>'))
print(json.dumps({'title':root.xpath('//h1')[0].text_content(),'photos':len(root.xpath('//main//img')),'styles':len(root.xpath('//style')),'mounts':3},ensure_ascii=False))
