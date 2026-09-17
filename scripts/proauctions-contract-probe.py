"""Small source-contract probe: saved ten lots, two public docs, gallery decoding."""
import hashlib, json, re, urllib.request, urllib.error
from pathlib import Path
from io import BytesIO
from PIL import Image, ImageOps, ImageDraw
from concurrent.futures import ThreadPoolExecutor
from html import unescape

out=Path('proauctions-contract');out.mkdir(exist_ok=True)
logs=[]
def get(url, target):
    try:
        req=urllib.request.Request(url,headers={'User-Agent':'AvtoCena source contract check/1.0'})
        with urllib.request.urlopen(req,timeout=20) as response:
            data=response.read(3_000_001)
            if len(data)>3_000_000: raise ValueError('response_too_large')
            target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
            logs.append({'url':url,'status':response.status,'sha256':hashlib.sha256(data).hexdigest(),'file':str(target)})
            return data
    except Exception as error:
        logs.append({'url':url,'error':str(error)});return None
for name,url in [('calculator','https://demo.pro-auctions.ru/calculator/'),('questions','https://demo.pro-auctions.ru/voprosy-i-otvety/')]:
    get(url,out/(name+'.html'))
# Decode only the primary car gallery; do not mix recommendations or auction sheets.
photos=[]
for p in sorted(Path('saved-evidence/source-recheck/proauctions').glob('*.html')):
    h=p.read_text();block=re.search(r'<!-- gallery-->(.*?)<!-- end gallery\s*-->',h,re.S)
    if not block: continue
    urls=list(dict.fromkeys(unescape(u) for u in re.findall(r'<a[^>]*href="([^"]+)"[^>]*data-fancybox="gallery"',block[1])))[:2]
    for i,url in enumerate(urls):
        if re.fullmatch(r'https://jp\d+\.pa-server\.ru/auc_auto/[0-9_]+/\d+/[^?#]+',url):photos.append((p.stem,i,url))
def photo(args):
    sid,i,url=args;data=get(url,out/'images'/f'{sid}-{i}.webp')
    result={'sourceId':sid,'url':url}
    if data:
        try:
            im=Image.open(BytesIO(data));im.load(); rgb=im.convert('RGB')
            result.update(size=list(im.size),decodedSha256=hashlib.sha256(rgb.tobytes()).hexdigest())
            return result,rgb
        except Exception as e: result['error']=str(e)
    return result,None
results=list(ThreadPoolExecutor(max_workers=4).map(photo,photos))
contact=Image.new('RGB',(800,max(1,(len(results)+3)//4)*175),'white');draw=ImageDraw.Draw(contact)
for n,(r,im) in enumerate(results):
    x=(n%4)*200;y=(n//4)*175
    if im:contact.paste(ImageOps.contain(im,(198,145)),(x,y))
    draw.text((x+3,y+148),r['sourceId'],fill='black')
contact.save(out/'gallery-contact.jpg')
(out/'gallery.json').write_text(json.dumps([r for r,_ in results],indent=2))
(out/'requests.json').write_text(json.dumps(logs,indent=2))
print(json.dumps({'photoRequests':len(photos),'decoded':sum(im is not None for _,im in results),'documents':logs[:2]}))
