import Link from "next/link";
import { getOffer, publicOffer, searchOffers } from "@/lib/catalog/storage";
import { money } from "@/lib/avtocena";
import { OfferLeadForm } from "@/components/catalog/OfferLeadForm";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { FavoriteToggle } from "@/components/catalog/FavoriteToggle";
import { VehicleGallery } from "@/components/catalog/VehicleGallery";
import { CatalogCard } from "@/components/catalog/CatalogCard";
import { presentCatalogOffer } from "@/lib/catalog/presentation";

function SpecItem({ label, value }: { label: string; value: string }) { return <div className="min-w-0 rounded-2xl bg-white/[0.04] p-3.5"><div className="text-[10px] font-black uppercase tracking-[0.15em] text-red-500">{label}</div><div className="mt-1.5 break-words text-[15px] font-black">{value}</div></div>; }

export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const offer = await getOffer(id);
  if (!offer) return <main className="ac-page-copy min-h-screen bg-[#07080d] text-white"><PublicHeader backHref="/cars" backLabel="В каталог" /><section className="mx-auto max-w-4xl px-4 py-20 text-center"><h1 className="text-4xl font-black">Предложение не найдено</h1><Link href="/cars" className="avto-button mt-7 inline-block rounded-2xl px-6 py-4 font-black">Открыть каталог</Link></section></main>;
  const raw:any = publicOffer(offer); const o = presentCatalogOffer(raw);
  const similarResult = await searchOffers({ market:raw.market, make:raw.make, budgetTo:raw.totalRub ? Math.round(raw.totalRub*1.25) : undefined, pageSize:8, sort:"updatedAt" });
  const similar = similarResult.items.filter((item:any)=>item.id!==raw.id).slice(0,6);
  const snapshot = { id:o.id,title:o.title,price:o.totalRub,imageUrl:o.images[0],year:o.year,mileageKm:o.mileageKm,marketLabel:o.marketLabel,href:`/cars/offer/${o.id}` };

  return <main className="ac-page-copy min-h-screen overflow-x-hidden bg-[#07080d] text-white"><PublicHeader backHref="/cars" backLabel="В каталог" />
    <section className="mx-auto w-full max-w-[1450px] px-4 py-7 md:px-8 md:py-10">
      <div className="grid min-w-0 gap-7 xl:grid-cols-[minmax(0,1.25fr)_430px] xl:items-start">
        <div className="min-w-0 overflow-hidden"><VehicleGallery images={o.images} title={o.title} /></div>
        <aside className="ac-offer-panel min-w-0 rounded-[1.8rem] bg-white/[0.05] p-5 md:p-7 xl:sticky xl:top-24">
          <div className="text-xs font-black uppercase tracking-[0.17em] text-red-500">{o.marketLabel}</div>
          <div className="mt-2 flex items-start gap-1"><FavoriteToggle offerId={o.id} inline snapshot={snapshot} /><h1 className="min-w-0 break-words text-3xl font-black leading-[1.02] tracking-[-0.04em] md:text-4xl">{o.title}</h1></div>
          <div className="mt-5 rounded-[1.35rem] bg-red-500/[0.075] p-4"><div className="text-[10px] font-black uppercase tracking-[0.16em] text-red-500">Ориентир стоимости</div><div className="mt-1 break-words text-3xl font-black tracking-[-0.04em] text-red-500 md:text-4xl">{o.totalRub ? `${money(o.totalRub)} ₽` : "Запросить точный расчёт"}</div></div>
          {o.priceMode === "auction_start" ? <p className="mt-3 rounded-2xl bg-amber-400/10 p-3 text-sm font-bold text-amber-200">Расчёт сделан от стартовой цены. Финальная стоимость аукциона может измениться.</p> : null}
          <div className="mt-5 grid grid-cols-2 gap-3"><SpecItem label="Год" value={String(o.year)} /><SpecItem label="Пробег" value={o.mileageKm ? `${money(o.mileageKm)} км` : "уточняется"} /><SpecItem label="Двигатель" value={o.engineCc ? `${o.engineCc} см³` : "уточняется"} /><SpecItem label="Топливо" value={o.fuelLabel} /><SpecItem label="Мощность" value={o.powerHp ? `${o.powerHp} л.с.` : "уточняется"} /><SpecItem label="Коробка" value={o.transmissionLabel} /><SpecItem label="Привод" value={o.driveLabel} /><SpecItem label="Кузов" value={o.bodyLabel} /></div>
          <div className="mt-5 rounded-2xl bg-white/[0.025] p-3.5"><div className="text-[10px] font-black uppercase tracking-[0.15em] text-white/45">Статус предложения</div><p className="mt-1.5 text-xs font-bold leading-5 text-white/58">Обновлено {new Date(o.updatedAt).toLocaleString("ru-RU")}. Наличие и финальную стоимость под ключ подтвердит менеджер.</p></div>
          <OfferLeadForm offerId={o.id} />
        </aside>
      </div>
      <section className="mt-12 md:mt-16"><div className="flex items-end justify-between gap-3"><div><div className="text-xs font-black uppercase tracking-[0.18em] text-red-500">Ещё варианты</div><h2 className="mt-2 text-3xl font-black md:text-5xl">Похожие автомобили</h2></div><Link href={`/cars?market=${encodeURIComponent(raw.market)}&make=${encodeURIComponent(raw.make)}`} className="font-black">Смотреть все →</Link></div>
        {similar.length ? <div className="ac-result-rail ac-hide-scrollbar mt-6">{similar.map((item:any)=><CatalogCard key={item.id} offer={item} compact />)}</div> : <div className="mt-6 rounded-[1.7rem] bg-white/[0.04] p-6 text-white/55">Похожие варианты сейчас обновляются.</div>}
      </section>
    </section>
  </main>;
}
