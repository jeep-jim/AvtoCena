import {MarketResultCount} from './MarketResultCount';
import {CatalogCountLabel} from './CatalogCountLabel';
import {CatalogSidebar} from './CatalogSidebar';
import {DealerBrowsingProvider} from "@/components/dealers/DealerBrowsingContext";
import {resolveDealerBrowsingContext} from "@/lib/dealers/resolve-browsing-context";
import {redirect} from "next/navigation";
import { cookies } from "next/headers";
import { GreenCornerDeliveryBanner } from "@/components/catalog/GreenCornerDeliveryBanner";
import { CatalogFilters } from "@/components/catalog/CatalogFilters";
import { CatalogLoadMore } from "@/components/catalog/CatalogLoadMore";
import { JapanSectionTabs } from "@/components/catalog/JapanSectionTabs";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { CatalogCard } from "@/components/catalog/CatalogCard";
import { readGreenCornerPage, readGreenCorner, publicGreenOffer } from "@/lib/catalog/green-corner";


export async function GreenCornerCatalog({params:input,embedded=false}:{params:Record<string,string|undefined>;embedded?:boolean}){
 const params={...input};
 const dealer=await resolveDealerBrowsingContext(params.dealer||"",params.preview==="1");
 if(dealer&&!dealer.markets.includes("japan"))redirect(dealer.href);
 if(params.city===undefined)params.city=(await cookies()).get("avtocena_city")?.value || "";
 const snapshot=await readGreenCorner();
 const query=String(params.q||"").trim().toLowerCase().slice(0,100);
 const result=await readGreenCornerPage(snapshot.items,{...params,q:query});
 const initial=Object.fromEntries(Object.entries({...params,market:"japan",stock:"green"}).filter((entry):entry is [string,string]=>typeof entry[1]==="string"));
 const Container=embedded?"div":"main";
 const page=result.page;
 const items=result.items.map(publicGreenOffer);

 // Embedded catalogs already inherit the authorized profile's browsing provider.
 // Keep this root a direct #catalog child: dealer CSS places its filters and
 // results in the profile grid. A nested provider adds a blocking box and dock.
 const content=<Container className={`ac-catalog-page ac-page-copy ${embedded?"dealer-shared-catalog":"min-h-screen bg-[#07080d] text-white"}`}>{!embedded&&<PublicHeader backHref="/cars" backLabel="Каталог" />}<div className={embedded?"ac-catalog-shell w-full py-5":"ac-catalog-shell mx-auto w-full max-w-[1500px] px-4 py-6 md:px-8 md:py-10"}>
  <CatalogSidebar dealerLayout={embedded} filters={<CatalogFilters initial={initial} facets={result.facets} resultCount={result.total} />} header={<>
  <div className="ac-green-intro"><div>
  <div className={embedded?"ac-dealer-catalog-title-line":"contents"}>
  <h1 className="ac-green-heading mt-8 text-4xl font-black md:text-6xl">Зелёный угол</h1>
  {embedded&&<p className="ac-catalog-result-count hidden md:flex items-center gap-2 text-[var(--ac-muted)]" role="status">
   <span className="ac-pulse-dot ac-pulse-dot--status shrink-0" aria-hidden="true"><span/></span>
   <CatalogCountLabel total={result.total}/>
  </p>}
  </div>
  <p className="mt-4 max-w-2xl text-[var(--ac-muted)]">Автомобили в наличии в Японии — без участия в аукциона.</p>
  </div><GreenCornerDeliveryBanner /></div>
  </>}>
  <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><h2 className="flex flex-wrap items-center gap-2 text-2xl font-black"><span>Япония · В наличии</span><MarketResultCount total={result.total}>{result.total.toLocaleString("ru-RU")}</MarketResultCount></h2><JapanSectionTabs active="green" params={initial}/></div>
  <div className="mt-5"><CatalogLoadMore key={`${JSON.stringify(initial)}:${page}`} query={{}} greenQuery={initial} initialPage={page} initialTotal={result.total} initialCount={items.length} initialCards={items.map(offer=><CatalogCard key={offer.id} offer={offer} compact dense />)} /></div>
  {!items.length?<p className="py-8">Подходящих автомобилей пока нет.</p>:null}
</CatalogSidebar>
 </div></Container>;
 return embedded?content:<DealerBrowsingProvider dealer={dealer}>{content}</DealerBrowsingProvider>;
}
