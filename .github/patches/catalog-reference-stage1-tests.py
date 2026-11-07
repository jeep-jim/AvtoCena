from pathlib import Path

def edit(path,old,new,count=1):
 p=Path(path);s=p.read_text()
 if s.count(old)!=count:raise RuntimeError(f'{path}: anchor mismatch {old[:90]}')
 p.write_text(s.replace(old,new))

# Keep exactly the same host/credential/path validation without a React server
# runtime, storage, or customs calculation import in pure URL tests.
p=Path('apps/web/lib/contracts/calculation.ts');s=p.read_text()
lines=[line for line in s.splitlines() if line.startswith('export function extractOfferId(')]
if len(lines)!=1:raise RuntimeError('contract URL parser anchor mismatch')
Path('apps/web/lib/contracts/offer-url-input.ts').write_text("import {offerRouteId} from '../catalog/offer-url';\n"+lines[0]+'\n')
s=s.replace(lines[0],"import {extractOfferId} from './offer-url-input';\nexport {extractOfferId} from './offer-url-input';")
s=s.replace("import {offerRouteId,offerPath}","import {offerPath}")
p.write_text(s)
edit('tests/catalog-reference-routes.test.ts',"from '../apps/web/lib/contracts/calculation'","from '../apps/web/lib/contracts/offer-url-input'")
edit('tests/offer-share.test.ts',"import {offerPath,offerRouteId}","import {offerPath,offerRouteId,offerIdFromPath}")
edit('tests/offer-share.test.ts',r"assert.match(path,/^\/cars\/offer\/[a-z0-9-]+$/);assert.match(path,/chevrolet-trax/);assert.match(path,/2024--f649514e83647d1d84c917e0$/);assert.equal(offerRouteId(path.split('/').at(-1)!),offer.id);",r"assert.match(path,/^\/cars\/offer\/[a-z0-9-]+\/[a-z0-9-]+$/);assert.match(path,/chevrolet-trax/);assert.match(path,/\/f649514e83647d1d84c917e0\/[^/]+2024$/);assert.equal(offerIdFromPath(path),offer.id);")
p='apps/web/components/telegram/TelegramMiniApp.tsx'
edit(p,'"use client";','"use client";\nimport {isCatalogSearchPath} from "../../lib/catalog/catalog-routes";')
edit(p,'const atCatalog=pathname==="/mini"||pathname==="/cars"||pathname==="/cars/green";','const atCatalog=pathname==="/mini"||isCatalogSearchPath(pathname);')
with Path('tests/catalog-reference-routes.test.ts').open('a') as f:f.write('''
test('contract URLs reject external hosts, credentials, unsafe identifiers and extra segments',()=>{
 for(const value of ['https://evil.example/cars/offer/id/slug','https://avtocena.com:444/cars/offer/id/slug','https://user:pass@avtocena.com/cars/offer/id/slug','https://avtocena.com/cars/offer/%2Fprivate/slug','https://avtocena.com/cars/offer/id/slug/extra'])assert.throws(()=>extractOfferId(value));
 const mini=fs.readFileSync('apps/web/components/telegram/TelegramMiniApp.tsx','utf8');
 assert.match(mini,/isCatalogSearchPath\\(pathname\\)/);
});
''')
# The old dependency harness assumed every imported filename was a component.
# Load the real pure routing helper rather than manufacture an invalid mock name.
p='tests/ajes-catalog-progressive.test.ts'
edit(p,"import test from 'node:test';","import test from 'node:test';\nimport {readFileSync} from 'node:fs';")
edit(p,"    if(args.path.endsWith('/ajes-catalog'))", "    if(args.path.endsWith('/catalog-routes'))return {contents:readFileSync('apps/web/lib/catalog/catalog-routes.ts','utf8'),loader:'ts'};\n    if(args.path.endsWith('/ajes-catalog'))")
p='tests/autobot.test.ts'
edit(p,"export const offerRouteId=()=> 'nexo-2022';","export const offerRouteId=()=> 'nexo-2022';export const offerIdFromPath=()=> 'nexo-2022';")
edit(p,"export const offerRouteId=x=>x;export const offerPath=x=>'/cars/offer/'+x.id;","export const offerRouteId=x=>x;export const offerIdFromPath=x=>x.split('?')[0].split('/')[3]?.split('--').at(-1);export const offerPath=x=>'/cars/offer/'+x.id;",2)
# Preserve the existing auction-mode label under the new country-specific H1.
p='apps/web/components/catalog/CatalogContent.tsx'
edit(p,'{embedded ? "Авто под заказ" : catalogSearchHeading(params)}</h1>','{embedded ? "Авто под заказ" : catalogSearchHeading(params)}</h1>\n        {japanStatisticsSelected&&!embedded?<p className="mt-2 text-sm text-[var(--ac-muted)]">Аукционная статистика</p>:null}')
p='tests/power30.test.ts'
edit(p,"['https://avtocena.com/cars/offer/abc','abc'],","['https://avtocena.com/cars/offer/abc','abc'],['https://avtocena.com/cars/offer/abc/model-2024','abc'],")
edit(p,"'https://avtocena.com/cars/offer/a/more',null","'https://avtocena.com/cars/offer/a/model-2024/extra','https://avtocena.com/cars/offer/a/%2Fsecret',null")
print('ROUTE_COMPATIBILITY_TESTS_APPLIED')
