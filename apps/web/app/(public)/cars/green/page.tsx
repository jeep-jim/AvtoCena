import { CatalogFilters } from "@/components/catalog/CatalogFilters";
import { filterGreenCorner, greenCornerFacets } from "@/lib/catalog/green-corner-search";
import { CatalogLoadMore } from "@/components/catalog/CatalogLoadMore";
import { JapanSectionTabs } from "@/components/catalog/JapanSectionTabs";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { CatalogCard } from "@/components/catalog/CatalogCard";
import { currentGreenCornerPrices, readGreenCorner, publicGreenOffer } from "@/lib/catalog/green-corner";
import { applyActiveBusinessPricingBatch } from "@/lib/catalog/live-business-pricing";
export const dynamic="force-dynamic";
export const metadata={title:"Зелёный угол — автомобили в наличии в Японии | АвтоЦена"};
export default async function GreenCornerPage({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 const params=await searchParams;
 const snapshot=await readGreenCorner();
 const query=String(params.q||"").trim().toLowerCase().slice(0,100);
 const current=await currentGreenCornerPrices(snapshot.items);
 const matched=filterGreenCorner(current,{...params,q:query});
 const initial=Object.fromEntries(Object.entries({...params,market:"japan",stock:"green"}).filter((entry):entry is [string,string]=>typeof entry[1]==="string"));
 const pages=Math.max(1,Math.ceil(matched.length/24));
 const page=Math.max(1,Math.min(pages,Math.floor(Number(params.page)||1)));
 const items=await applyActiveBusinessPricingBatch(matched.slice((page-1)*24,page*24).map(publicGreenOffer));

 return <main className="ac-catalog-page ac-page-copy min-h-screen bg-[#07080d] text-white"><PublicHeader backHref="/cars" backLabel="Каталог" /><div className="mx-auto w-full max-w-[1500px] px-4 py-6 md:px-8 md:py-10">
  <JapanSectionTabs active="green" params={initial} />
  <h1 className="ac-green-heading mt-8 text-4xl font-black md:text-6xl">Зелёный угол</h1>
  <p className="mt-4 max-w-2xl text-[var(--ac-muted)]">Автомобили в наличии в Японии — без участия в аукционе.</p>
  <CatalogFilters initial={initial} facets={greenCornerFacets(current)} />
  <p className="mt-5 text-sm text-[var(--ac-muted)]" role="status" data-catalog-result-count={matched.length}>Найдено: {matched.length.toLocaleString("ru-RU")}</p>
  <div className="mt-5"><CatalogLoadMore key={`${JSON.stringify(initial)}:${page}`} query={{}} greenQuery={initial} initialPage={page} initialTotal={matched.length} initialCount={items.length} initialCards={items.map(offer=><CatalogCard key={offer.id} offer={offer} compact dense />)} /></div>
  {!items.length?<p className="py-8">Подходящих автомобилей пока нет.</p>:null}
 </div></main>;
}
