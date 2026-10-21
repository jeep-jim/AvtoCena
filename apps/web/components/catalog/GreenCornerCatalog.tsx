import {MarketResultCount} from './MarketResultCount';
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

 return <DealerBrowsingProvider dealer={dealer}><Container className="ac-catalog-page ac-page-copy min-h-screen bg-[#07080d] text-white">{!embedded&&<PublicHeader backHref="/cars" backLabel="Каталог" />}<div className="ac-catalog-shell mx-auto w-full max-w-[1500px] px-4 py-6 md:px-8 md:py-10">
  <CatalogSidebar filters={<CatalogFilters initial={initial} facets={result.facets} resultCount={result.total} />} header={<>
  <div className="ac-green-intro"><div>
  <h1 className="ac-green-heading mt-8 text-4xl font-black md:text-6xl">Зелёный угол</h1>
  <p className="mt-4 max-w-2xl text-[var(--ac-muted)]">Автомобили в наличии в Японии — без участия в аукционе.</p>
  </div><GreenCornerDeliveryBanner /></div>
  </>}>
  <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><h2 className="flex flex-wrap items-center gap-2 text-2xl font-black"><span>Япония · В наличии</span><MarketResultCount total={result.total}>{result.total.toLocaleString("ru-RU")}</MarketResultCount></h2><JapanSectionTabs active="green" params={initial}/></div>
  <div className="mt-5"><CatalogLoadMore key={`${JSON.stringify(initial)}:${page}`} query={{}} greenQuery={initial} initialPage={page} initialTotal={result.total} initialCount={items.length} initialCards={items.map(offer=><CatalogCard key={offer.id} offer={offer} compact dense />)} /></div>
  {!items.length?<p className="py-8">Подходящих автомобилей пока нет.</p>:null}
</CatalogSidebar>
 </div></Container></DealerBrowsingProvider>;
}
