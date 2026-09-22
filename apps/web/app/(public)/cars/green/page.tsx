import { CatalogFilters } from "@/components/catalog/CatalogFilters";
import { filterGreenCorner, greenCornerFacets } from "@/lib/catalog/green-corner-search";
import { CatalogLoadMore } from "@/components/catalog/CatalogLoadMore";
import { JapanSectionTabs } from "@/components/catalog/JapanSectionTabs";
import { PublicHeader } from "@/components/layout/PublicHeader";
import Link from "next/link";
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

 return <main className="ac-page-copy min-h-screen bg-[#07080d] text-white"><div className="mx-auto max-w-[1440px] px-4 py-8 md:px-8"><PublicHeader backHref="/cars" backLabel="Каталог" /><Link href="/cars" className="text-sm font-bold">← Каталог автомобилей</Link>
  <JapanSectionTabs active="green" params={initial} />
  <p className="mt-8 text-sm font-bold text-emerald-600">Япония · автомобили в наличии</p><h1 className="ac-green-heading mt-2 text-4xl font-black md:text-6xl">Зелёный угол</h1>
  <p className="mt-4 max-w-2xl text-[var(--ac-muted)]">Эти машины уже выкуплены — участвовать в аукционе не нужно. Расчёт на основе FOB: логистика привязана к курсу иены, остальные расходы — как для Японии. Наличие подтвердит менеджер.</p>
  <CatalogFilters initial={initial} facets={greenCornerFacets(current)} />
  <p className="mt-3 text-xs text-[var(--ac-muted)]">Цена в фильтрах — FOB в рублях по текущему курсу. Полный расчёт — в карточке. Мощность — по данным продавца; для гибридов и электромобилей расчётную мощность нужно подтвердить.</p>
  <p className="mt-5 text-sm text-[var(--ac-muted)]">Найдено: {matched.length.toLocaleString("ru-RU")}</p>
  <div className="mt-5"><CatalogLoadMore key={`${JSON.stringify(initial)}:${page}`} query={{}} greenQuery={initial} initialPage={page} initialTotal={matched.length} initialCount={items.length} initialCards={items.map(offer=><CatalogCard key={offer.id} offer={offer} compact dense />)} /></div>
  {!items.length?<p className="py-8">Подходящих автомобилей пока нет.</p>:null}
 </div></main>;
}
