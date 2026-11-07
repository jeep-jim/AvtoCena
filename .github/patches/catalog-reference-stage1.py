from pathlib import Path

def edit(path,old,new,count=1):
 p=Path(path);s=p.read_text();actual=s.count(old)
 if actual!=count:raise RuntimeError(f'{path}: expected {count} anchors, found {actual}: {old[:100]}')
 p.write_text(s.replace(old,new))

def prepend(path,text):
 p=Path(path);p.write_text(text+p.read_text())

edit('apps/web/lib/dealers/browsing-context.ts','import type { DealerMarket }',"import {canonicalCatalogHref,catalogRouteParams,isCatalogSearchPath} from '../catalog/catalog-routes';\nimport type { DealerMarket }")
edit('apps/web/lib/dealers/browsing-context.ts'," if(!dealer || !href.startsWith('/') || href.startsWith('//'))return href;"," if(!dealer || !href.startsWith('/') || href.startsWith('//'))return canonicalCatalogHref(href);")
edit('apps/web/lib/dealers/browsing-context.ts'," if(url.pathname==='/cars'||url.pathname==='/cars/green') {"," if(isCatalogSearchPath(url.pathname)) {")
edit('apps/web/lib/dealers/browsing-context.ts',"  if(url.pathname==='/cars/green'){","  const route=catalogRouteParams(url.pathname);if(route)for(const [key,value] of Object.entries(route))if(value)target.searchParams.set(key,value);\n  if(url.pathname==='/cars/green'){")
edit('apps/web/components/dealers/DealerBrowsingContext.tsx','import Link from',"import {isCatalogSearchPath} from '@/lib/catalog/catalog-routes';\nimport Link from")
edit('apps/web/components/dealers/DealerBrowsingContext.tsx',"(href.split('?')[0]==='/cars'||href.split('?')[0]==='/cars/green')","isCatalogSearchPath(href.split(/[?#]/)[0])")
edit('apps/web/components/dealers/DealerBrowsingContext.tsx',"location.pathname==='/cars'||location.pathname==='/cars/green'","isCatalogSearchPath(location.pathname)")
prepend('apps/web/middleware.ts',"import {canonicalCatalogHref} from './lib/catalog/catalog-routes';\n")
edit('apps/web/middleware.ts','  const legacyOffer=pathname.match',"  if (request.method === 'GET' || request.method === 'HEAD') {\n    const current = pathname + request.nextUrl.search;\n    const canonical = canonicalCatalogHref(current);\n    if (canonical !== current) return NextResponse.redirect(new URL(canonical, request.url), 308);\n  }\n\n  const legacyOffer=pathname.match")
edit('apps/web/lib/catalog/search-metadata.ts',"export const SEARCH_MARKETS:Record<string,string>={japan:'Японии',china:'Китая',korea:'Кореи',uae:'ОАЭ',europe:'Европы',georgia:'Грузии'};","import {CATALOG_COUNTRIES,catalogSearchHeading} from './catalog-routes';\nexport const SEARCH_MARKETS=CATALOG_COUNTRIES;")
edit('apps/web/lib/catalog/search-metadata.ts',"const title=`${subject}${country?` из ${country}`:''} — каталог и расчёт цены${page>1?` · страница ${page}`:''} — АвтоЦена`;","const title=`${catalogSearchHeading(params)} — каталог и расчёт цены${page>1?` · страница ${page}`:''} — АвтоЦена`;")
prepend('apps/web/components/catalog/CatalogContent.tsx',"import {readMarketSection} from '@/lib/catalog/market-section-result';\nimport {catalogSearchHeading,canonicalCatalogHref} from '@/lib/catalog/catalog-routes';\n")
prepend('apps/web/components/catalog/AjesCatalog.tsx',"import {catalogSearchHeading} from '@/lib/catalog/catalog-routes';\n")
p='apps/web/components/catalog/CatalogContent.tsx'
edit(p,'header={<h1 className="text-3xl font-black">Каталог автомобилей</h1>}','header={<h1 className="text-3xl font-black">{embedded?"Авто под заказ":catalogSearchHeading(params)}</h1>}')
edit(p,'japanStatisticsSelected ? "Аукционная статистика" : embedded ? "Авто под заказ" : "Каталог автомобилей"','embedded ? "Авто под заказ" : catalogSearchHeading(params)')
edit(p,'return suffix ? `/cars?${suffix}` : "/cars";','return canonicalCatalogHref(suffix ? `/cars?${suffix}` : "/cars");',2)
edit('apps/web/components/catalog/AjesCatalog.tsx','embedded?"Авто под заказ":"Каталог автомобилей"','embedded?"Авто под заказ":catalogSearchHeading(initial)')
edit('apps/web/components/site/SitePageAccess.tsx','<h1 ','<h2 ')
edit('apps/web/components/site/SitePageAccess.tsx','</h1>','</h2>')
prepend('apps/web/app/(public)/layout.tsx',"import '@fontsource-variable/onest/cyrillic.css';\nimport '@fontsource-variable/onest/latin.css';\nimport '../public-typography.css';\n")
edit('apps/web/app/(public)/layout.tsx','<ConsentMetrika /><AnalyticsChoiceNotice/>','<span data-public-typography="onest" hidden aria-hidden="true"/><ConsentMetrika /><AnalyticsChoiceNotice/>')
p='apps/web/components/layout/RoutePreloader.tsx';s=Path(p).read_text();line=s.find('\n');assert 'use client' in s[:line];Path(p).write_text(s[:line+1]+"import {isCatalogSearchPath} from '@/lib/catalog/catalog-routes';\n"+s[line+1:])
edit(p,'if(url.pathname==="/cars"&&url.search)return;','if(isCatalogSearchPath(url.pathname))return;')
p='apps/web/lib/catalog/offer-url.ts'
edit(p,'/** Stable identity stays in the suffix; vehicle names remain readable to people and crawlers. */','/** Stable identity is a separate path segment; legacy slug--id links remain resolvable. */')
edit(p,"  return `/cars/offer/${slug ? `${encodeURIComponent(slug)}--` : ''}${encodeURIComponent(id)}`;","  if(id.startsWith('special_'))return `/cars/offer/${encodeURIComponent(id)}`;\n  return `/cars/offer/${encodeURIComponent(id)}${slug ? `/${encodeURIComponent(slug)}` : ''}`;")
with Path(p).open('a') as f:f.write(r'''
export function offerIdFromPath(value:string):string {
 try {
  const pathname=new URL(value,'https://avtocena.com').pathname;
  const match=pathname.match(/^\/cars\/offer\/([^/]+)(?:\/[^/]+)?\/?$/);
  if(!match)return '';
  const id=offerRouteId(decodeURIComponent(match[1]));
  return !id || id==='.' || id==='..' || /[\/\\\u0000-\u001f]/.test(id) ? '' : id;
 } catch {return '';}
}
''')
p='apps/web/app/(public)/cars/offer/[id]/page.tsx'
edit(p,'params: Promise<{ id: string }>','params: Promise<{ id: string; slug?: string }>')
edit(p,'const { id: routeId } = await params;','const { id: routeId, slug: routeSlug } = await params;')
edit(p,'if (`/cars/offer/${encodeURIComponent(routeId)}` !== canonicalPath && `/cars/offer/${routeId}` !== canonicalPath)','if (`/cars/offer/${encodeURIComponent(routeId)}${routeSlug ? `/${encodeURIComponent(routeSlug)}` : ""}` !== canonicalPath && `/cars/offer/${routeId}${routeSlug ? `/${routeSlug}` : ""}` !== canonicalPath)')
p='apps/web/components/catalog/ShareLinkButton.tsx'
edit(p,'import {offerRouteId}','import {offerIdFromPath}')
edit(p,'offerRouteId(decodeURIComponent(target.pathname.slice("/cars/offer/".length)))','offerIdFromPath(target.pathname)')
p='apps/web/lib/autobot/agent.ts'
edit(p,'import {offerPath,offerRouteId}','import {offerPath,offerIdFromPath}')
edit(p,"offerRouteId(decodeURIComponent(path.split('?')[0].split('/').pop()||''))",'offerIdFromPath(path)')
prepend(p,"import {catalogRouteParams,isCatalogSearchPath} from '../catalog/catalog-routes';\n")
edit(p,"if(!current&&path.startsWith('/cars?')){","if(!current&&isCatalogSearchPath(path.split('?')[0])){")
edit(p,"const filters=new URL(path,'https://avtocena.com').searchParams;","const url=new URL(path,'https://avtocena.com'),filters=url.searchParams;\n  const route=catalogRouteParams(url.pathname);if(route)for(const [k,v] of Object.entries(route))if(v)filters.set(k,v);")
p='apps/web/lib/catalog/short-share.ts'
edit(p,r'[A-Za-z0-9_%.-]+(?:\?|$)',r'[A-Za-z0-9_%.-]+(?:\/[A-Za-z0-9_-]{1,160})?(?:\?|$)')
edit(p,r'[A-Za-z0-9_-]{1,240}$',r'[A-Za-z0-9_-]{1,240}(?:\/[A-Za-z0-9_-]{1,160})?$')
for p in ['apps/web/lib/contracts/calculation.ts','apps/web/lib/power30/calculator.ts']:
 edit(p,r'^\/cars\/offer\/([^/]+)\/?$',r'^\/cars\/offer\/([^/]+)(?:\/[A-Za-z0-9_-]{1,160})?\/?$')
p='tests/staff-avatar-presence-url.test.ts'
edit(p,'{offerPath,offerRouteId}','{offerPath,offerRouteId,offerIdFromPath}')
edit(p,"'/cars/offer/honda-freed-air-ex-2026--green-707750'","'/cars/offer/green-707750/honda-freed-air-ex-2026'")
edit(p,"offerRouteId(offerPath(offer).split('/').pop()!)",'offerIdFromPath(offerPath(offer))')
edit(p,'/lada-vesta--a$/',r'/a\/lada-vesta$/')
p='apps/web/components/catalog/CatalogContent.tsx'
edit(p,'type MarketGroup = { id: string; label: string; items: any[]; total: number; page: number; pageSize: number };','type MarketGroup = { id: string; label: string; items: any[]; total: number; page: number; pageSize: number; unavailable?: boolean };')
edit(p,'groupedMarkets = await Promise.all(allowedMarkets.map(async (market) => {','groupedMarkets = await Promise.all(allowedMarkets.map((market) => readMarketSection(async () => {')
edit(p,'return { ...market, items: balanceBusinessRows(visible), total: snapshot.total, page: 1, pageSize: OVERVIEW_CARDS };\n    }));','return { ...market, items: balanceBusinessRows(visible), total: snapshot.total, page: 1, pageSize: OVERVIEW_CARDS };\n    }, {...market,items:[],total:0,page:1,pageSize:OVERVIEW_CARDS}, error=>console.error("catalog_market_unavailable",{market:market.id,...catalogFailureDiagnostic(error)}))));')
edit(p,'Promise.all(markets.map(async (market) => {','Promise.all(markets.map((market) => readMarketSection(async () => {')
edit(p,'return { ...market, items, total: result.total, page: result.page, pageSize: result.pageSize };\n      })),','return { ...market, items, total: result.total, page: result.page, pageSize: result.pageSize };\n      }, {...market,items:[],total:0,page:selectedMarket?requestedPage:1,pageSize:selectedMarket?MARKET_PAGE_SIZE:OVERVIEW_CARDS}, error=>console.error("catalog_market_unavailable",{market:market.id,...catalogFailureDiagnostic(error)})))),')
edit(p,'market.total > 0 || liveMarket(market.id)','market.unavailable || market.total > 0 || liveMarket(market.id)')
edit(p,'const localTotal=groupedMarkets.reduce','const localIncomplete=groupedMarkets.some(m=>m.unavailable);\n  const localTotal=groupedMarkets.reduce')
edit(p,'countIncomplete:(showGreen && !green) || counts.some(c=>c.incomplete),','countIncomplete:localIncomplete || (showGreen && !green) || counts.some(c=>c.incomplete),')
edit(p,'const total=localTotal,countIncomplete=railReads.size>0 || (showGreen && !green);','const total=localTotal,countIncomplete=localIncomplete || railReads.size>0 || (showGreen && !green);')
edit(p,'<MarketResultCount total={market.total}>{formatCatalogCount(market.total)}</MarketResultCount>','<MarketResultCount total={market.unavailable?undefined:market.total}>{market.unavailable?"Количество уточняется":formatCatalogCount(market.total)}</MarketResultCount>')
edit(p,'{market.items.length ? selectedMarket ?','{market.unavailable ? <p role="status" className="rounded-xl border border-[var(--ac-border)] p-4 text-sm">Не удалось загрузить автомобили этого направления. <Link href={pageHref({...params,market:market.id},requestedPage)} className="underline">Повторить</Link></p> : market.items.length ? selectedMarket ?')
edit(p,'{!selectedMarket&&<Suspense fallback={null}><CatalogEmptyResults','{!selectedMarket&&!localIncomplete&&<Suspense fallback={null}><CatalogEmptyResults')
p='apps/web/lib/catalog/offer-metadata.ts'
edit(p,'images:string[],index=true):Metadata','images:string[],index=true,canonical=url):Metadata')
edit(p,'alternates:{canonical:url}','alternates:{canonical}')
edit(p,'return metadata(previewTitle,description,url,images,Boolean(scenario||visibleRub||selectionRequired||sellerPricing));','const privateScenario=Boolean(q.preview||q.dealer||q.calculation||q.estimate||q.direct||q.powerHp||q.modificationId);\n return metadata(previewTitle,description,url,images,!privateScenario&&Boolean(scenario||visibleRub||selectionRequired||sellerPricing),absoluteAvtocenaUrl(offerPath(stored)));')
print('CATALOG_PRESENTATION_PATCH_APPLIED')
