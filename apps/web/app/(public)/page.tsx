"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { FavoriteToggle } from "@/components/catalog/FavoriteToggle";
import { appendAttributionToSearchParams, captureAttributionFromBrowser, trackAttributionEvent } from "@/lib/attribution";
import { presentCatalogOffer } from "@/lib/catalog/presentation";

const budgetOptions = [1500000, 2000000, 2500000, 3000000, 4000000, 5000000];
const yearOptions = [
  { value: "", label: "Любой год" },
  { value: "2026", label: "2026" },
  { value: "2025", label: "2025" },
  { value: "2024", label: "2024" },
  { value: "2023", label: "2023" },
  { value: "2022", label: "2022" },
  { value: "2021", label: "2021" },
  { value: "2020", label: "2020" },
  { value: "2019", label: "2019" },
  { value: "2018", label: "2018" },
  { value: "older", label: "Старше 2018" },
];
const marketOptions = [
  { value: "", label: "Любая страна" },
  { value: "japan", label: "Япония" },
  { value: "china", label: "Китай" },
  { value: "korea", label: "Корея" },
  { value: "uae", label: "ОАЭ" },
  { value: "europe", label: "Европа" },
];
const bodyOptions = [
  { value: "", label: "Любой кузов" },
  { value: "suv", label: "Кроссовер" },
  { value: "offroad", label: "Внедорожник" },
  { value: "sedan", label: "Седан" },
  { value: "hatchback", label: "Хэтчбек" },
  { value: "wagon", label: "Универсал" },
  { value: "minivan", label: "Минивэн" },
  { value: "coupe", label: "Купе" },
  { value: "pickup", label: "Пикап" },
];
const brandOptions = ["", "Toyota", "Honda", "Hyundai", "Kia", "Chevrolet", "Mercedes-Benz", "BMW", "Audi", "Lexus", "Genesis", "KGM"];
const buyerPhotos = Array.from({ length: 15 }, (_, index) => ({ src: `/buyers/${index + 1}.jpg`, alt: `Клиент TopAvto ${index + 1}` }));
const benefits = [
  { icon: "⚡", title: "Без регистрации", text: "Сразу получите первую выдачу по вашему бюджету." },
  { icon: "◎", title: "5 рынков", text: "Япония, Китай, Корея, ОАЭ и Европа в одном подборе." },
  { icon: "▣", title: "Под ключ", text: "Доставка, таможня и оформление входят в структуру расчёта." },
];

type HomeOffer = {
  id: string;
  title: string;
  brand: string;
  model: string;
  year: number;
  price: number;
  country: string;
  countryLabel: string;
  body: string;
  bodyLabel: string;
  mileageKm?: number;
  mileage: string;
  engine: string;
  power: string;
  images: string[];
  calculationSnapshot?: any;
};

function money(value: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(value));
}

function SelectBox({ value, onChange, children, ariaLabel }: { value: string; onChange: (value: string) => void; children: React.ReactNode; ariaLabel: string }) {
  return (
    <label className="relative min-w-0">
      <span className="sr-only">{ariaLabel}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="soft-input h-14 w-full appearance-none rounded-2xl bg-[#292b31] px-4 pr-11 text-sm font-black text-white outline-none">
        {children}
      </select>
      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/52">⌄</span>
    </label>
  );
}

function Calculator({ budget, setBudget, brand, setBrand, model, setModel, year, setYear, market, setMarket, body, setBody, foundCount, submit }: any) {
  return (
    <div id="form" className="rounded-[1.8rem] border border-white/12 bg-white/[0.085] p-4 shadow-[0_25px_90px_rgba(227,27,35,.16)] backdrop-blur-xl md:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-xs font-black uppercase tracking-[0.16em] text-red-200">Бюджет</div>
        <div className="rounded-full border border-white/18 bg-black/15 px-3 py-1.5 text-[11px] font-black text-white/72">🚗 Нашли {foundCount} вариантов</div>
      </div>
      <SelectBox value={budget} onChange={setBudget} ariaLabel="Бюджет">
        {budgetOptions.map((value) => <option key={value} value={value}>до {money(value)} ₽</option>)}
      </SelectBox>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <SelectBox value={brand} onChange={(next) => { setBrand(next); setModel(""); }} ariaLabel="Марка">
          {brandOptions.map((item) => <option key={item || "any"} value={item}>{item || "Любая марка"}</option>)}
        </SelectBox>
        <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Любая модель" className="soft-input h-14 min-w-0 rounded-2xl bg-[#292b31] px-4 text-sm font-black text-white outline-none" />
        <SelectBox value={year} onChange={setYear} ariaLabel="Год">
          {yearOptions.map((item) => <option key={item.value || "any"} value={item.value}>{item.label}</option>)}
        </SelectBox>
        <SelectBox value={market} onChange={setMarket} ariaLabel="Страна">
          {marketOptions.map((item) => <option key={item.value || "any"} value={item.value}>{item.label}</option>)}
        </SelectBox>
        <div className="col-span-2">
          <SelectBox value={body} onChange={setBody} ariaLabel="Тип кузова">
            {bodyOptions.map((item) => <option key={item.value || "any"} value={item.value}>{item.label}</option>)}
          </SelectBox>
        </div>
      </div>
      <button type="button" onClick={submit} className="avto-button mt-4 flex h-[58px] w-full items-center justify-center gap-3 rounded-2xl text-base font-black">
        <span className="h-3 w-3 rounded-full bg-white" /> Узнать АвтоЦену
      </button>
    </div>
  );
}

function BuyerGallery() {
  return (
    <section>
      <h2 className="text-3xl font-black tracking-[-0.04em] md:text-5xl">Те, кто узнали — уже ездят!</h2>
      <div className="ac-hide-scrollbar mt-5 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 md:gap-4">
        {buyerPhotos.map((photo) => (
          <div key={photo.src} className="h-48 w-[82vw] max-w-[360px] shrink-0 snap-start overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/[0.04] md:h-56 md:w-[360px]">
            <img src={photo.src} alt={photo.alt} className="h-full w-full object-cover" />
          </div>
        ))}
      </div>
    </section>
  );
}

function ExecutorBlock() {
  return (
    <section className="mt-4 grid gap-5 rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-5 md:grid-cols-[minmax(0,1fr)_290px] md:items-center md:p-6">
      <div>
        <h3 className="text-xl font-black">АвтоЦена — подбор автомобиля под ваш бюджет</h3>
        <p className="mt-3 max-w-4xl text-sm font-medium leading-7 text-white/58 md:text-[15px]">Сервис помогает быстро понять, какой автомобиль можно привезти из Японии, Китая, Кореи, ОАЭ или Европы. Вы задаёте базовые параметры, а система показывает реальные варианты для следующего шага с менеджером TopAvto.</p>
      </div>
      <div className="flex min-h-32 items-center justify-center rounded-[1.3rem] border border-white/10 bg-black/20 p-5">
        <img src="/brands/topavto-logo.png" alt="TopAvto" className="max-h-24 w-full object-contain" />
      </div>
    </section>
  );
}

function OfferCard({ offer, onOpen }: { offer: HomeOffer; onOpen: (offer: HomeOffer) => void }) {
  const imageUrl = offer.images[0];
  return (
    <article className="relative w-[84vw] max-w-[360px] shrink-0 snap-start overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/[0.05] md:w-auto md:max-w-none">
      <button type="button" onClick={() => onOpen(offer)} className="block w-full text-left">
        <div className="relative h-56 overflow-hidden bg-white/[0.04]">
          {imageUrl ? <img src={imageUrl} alt={offer.title} className="h-full w-full object-cover object-[center_38%]" /> : <div className="flex h-full items-center justify-center text-white/35">Фото загружается</div>}
          <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/90 via-black/45 to-transparent" />
          <div className="absolute left-3 top-3 rounded-full border border-white/18 bg-black/35 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] backdrop-blur">{offer.countryLabel}</div>
          <div className="absolute bottom-3 left-3 right-3">
            <div className="line-clamp-2 max-w-[86%] text-[19px] font-black leading-[1.08] tracking-[-0.03em] drop-shadow-[0_2px_16px_rgba(0,0,0,.75)]">{offer.title}</div>
            <div className="mt-2 flex gap-2 text-[11px] font-black text-white/85"><span className="rounded-full bg-black/40 px-3 py-1 backdrop-blur">{offer.year}</span><span className="rounded-full bg-black/40 px-3 py-1 backdrop-blur">{offer.mileage}</span></div>
          </div>
        </div>
        <div className="p-4">
          <div className="flex items-end justify-between gap-3"><div><div className="text-[10px] font-black uppercase tracking-[0.16em] text-white/36">Ориентир</div><div className="mt-1 text-2xl font-black tracking-[-0.04em]">{money(offer.price)} ₽</div></div><span className="rounded-xl bg-white/[0.07] px-3 py-2 text-xs font-black">Подробнее</span></div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-white/58"><span className="rounded-full bg-white/[0.05] px-3 py-1.5">{offer.engine}</span><span className="rounded-full bg-white/[0.05] px-3 py-1.5">{offer.power}</span></div>
        </div>
      </button>
      <FavoriteToggle offerId={offer.id} compact className="absolute right-3 top-3 z-20" snapshot={{ id: offer.id, title: offer.title, price: offer.price, imageUrl, year: offer.year, mileageKm: offer.mileageKm, marketLabel: offer.countryLabel, href: `/cars/offer/${offer.id}` }} />
    </article>
  );
}

function CostLines({ offer }: { offer: HomeOffer }) {
  const car = Math.round((offer.price * 0.58) / 10000) * 10000;
  const logistics = Math.round((offer.price * 0.09) / 10000) * 10000;
  const customs = Math.round((offer.price * 0.22) / 10000) * 10000;
  const broker = Math.round((offer.price * 0.05) / 10000) * 10000;
  const commission = Math.max(90000, Math.round((offer.price * 0.035) / 10000) * 10000);
  const lines = [["Стоимость авто", car], ["Логистика", logistics], ["Таможня и утиль", customs], ["Брокер и оформление", broker], ["Комиссия TopAvto", commission]] as const;
  return <div className="grid gap-2.5 text-sm font-bold text-white/68">{lines.map(([label, amount]) => <div key={label} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-2"><span className="text-red-300/65">·</span><span className="flex min-w-0 items-baseline gap-2"><span className="shrink-0">{label}</span><span className="mb-1 min-w-5 flex-1 border-b border-dotted border-white/10" /></span><span className="min-w-[105px] text-right font-black text-white">{money(amount)} ₽</span></div>)}</div>;
}

function OfferModal({ offer, onClose, onRequest }: { offer: HomeOffer | null; onClose: () => void; onRequest: (offer: HomeOffer) => void }) {
  const [photoIndex, setPhotoIndex] = useState(0);
  useEffect(() => setPhotoIndex(0), [offer?.id]);
  useEffect(() => {
    if (!offer) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", close); };
  }, [offer, onClose]);
  if (!offer || typeof document === "undefined") return null;
  const images = offer.images.length ? offer.images : [""];
  const previous = () => setPhotoIndex((current) => current === 0 ? images.length - 1 : current - 1);
  const next = () => setPhotoIndex((current) => (current + 1) % images.length);
  return createPortal(
    <div className="fixed inset-0 z-[9998] flex items-end justify-center bg-black/82 backdrop-blur-[8px] md:items-center md:p-5" role="dialog" aria-modal="true">
      <button type="button" onClick={onClose} className="absolute inset-0" aria-label="Закрыть" />
      <div className="relative z-10 max-h-[100dvh] w-full overflow-y-auto bg-[#0b0d14] md:max-h-[calc(100dvh-40px)] md:max-w-5xl md:rounded-[2rem]">
        <div className="relative h-[330px] overflow-hidden sm:h-[430px]">
          {images[photoIndex] ? <img src={images[photoIndex]} alt={offer.title} className="h-full w-full object-cover object-[center_32%]" /> : null}
          <div className="absolute inset-x-0 bottom-0 h-[48%] bg-gradient-to-t from-[#0b0d14] via-[#0b0d14]/58 to-transparent" />
          <div className="absolute left-4 top-4 flex flex-wrap gap-2 sm:left-6 sm:top-6"><span className="rounded-full bg-red-500 px-3 py-1 text-xs font-black">{offer.countryLabel}</span><span className="rounded-full bg-black/40 px-3 py-1 text-xs font-black backdrop-blur">{offer.bodyLabel}</span><span className="rounded-full bg-black/40 px-3 py-1 text-xs font-black backdrop-blur">{offer.year}</span></div>
          <button type="button" onClick={onClose} className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-2xl backdrop-blur sm:right-6 sm:top-6">×</button>
          {images.length > 1 ? <><button type="button" onClick={previous} className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-2xl backdrop-blur">‹</button><button type="button" onClick={next} className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-2xl backdrop-blur">›</button></> : null}
          <div className="absolute bottom-5 left-4 right-4 sm:bottom-7 sm:left-7 sm:right-7"><h2 className="max-w-3xl text-[30px] font-black leading-[.98] tracking-[-0.045em] sm:text-[46px]">{offer.title}</h2><div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-white/68"><span>{offer.engine}</span><span>·</span><span>{offer.power}</span></div></div>
        </div>
        {images.length > 1 ? <div className="ac-hide-scrollbar flex gap-2 overflow-x-auto px-4 pt-3 sm:px-6">{images.map((image, index) => <button key={`${image}-${index}`} type="button" onClick={() => setPhotoIndex(index)} className={`h-16 w-24 shrink-0 overflow-hidden rounded-xl border ${index === photoIndex ? "border-red-400" : "border-white/10 opacity-65"}`}><img src={image} alt="" className="h-full w-full object-cover" /></button>)}</div> : null}
        <div className="grid gap-6 p-5 sm:p-7 md:grid-cols-[minmax(0,1fr)_310px]"><div><p className="text-sm font-medium leading-7 text-white/58">Ориентировочная структура цены. Финальная стоимость зависит от курса, состояния автомобиля, даты покупки, логистики и города доставки.</p><div className="mt-5"><CostLines offer={offer} /></div></div><div className="md:border-l md:border-white/8 md:pl-6"><div className="text-xs font-black uppercase tracking-[0.18em] text-white/38">Ориентир цены</div><div className="mt-2 text-4xl font-black tracking-[-0.05em]">{money(offer.price)} ₽</div><div className="mt-1 text-sm font-black text-emerald-300">по текущему варианту</div><button type="button" onClick={() => onRequest(offer)} className="avto-button mt-6 h-14 w-full rounded-2xl font-black">Получить предложение</button><Link href={`/cars/offer/${offer.id}`} className="mt-3 block rounded-2xl bg-white/[0.06] px-5 py-4 text-center font-black">Открыть карточку</Link></div></div>
      </div>
    </div>, document.body,
  );
}

export default function HomePage() {
  const router = useRouter();
  const [budget, setBudget] = useState("3000000");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [market, setMarket] = useState("");
  const [body, setBody] = useState("");
  const [catalogMarket, setCatalogMarket] = useState("");
  const [catalogMake, setCatalogMake] = useState("");
  const [offers, setOffers] = useState<HomeOffer[]>([]);
  const [selectedOffer, setSelectedOffer] = useState<HomeOffer | null>(null);
  const allowDemo = process.env.NODE_ENV !== "production" || process.env.ENABLE_DEMO_CATALOG === "true" || process.env.NEXT_PUBLIC_ENABLE_DEMO_CATALOG === "true";

  useEffect(() => {
    const attribution = captureAttributionFromBrowser();
    if (attribution.clickId) void trackAttributionEvent("visit", attribution, { landingPath: window.location.pathname });
    fetch("/api/catalog/search?pageSize=12&sort=updatedAt", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        const items = Array.isArray(data?.items) ? data.items : [];
        setOffers(items.slice(0, 12).map((raw: any) => {
          const o = presentCatalogOffer(raw);
          return { id: o.id, title: o.title, brand: o.makeLabel, model: o.modelLabel, year: o.year, price: o.totalRub || 0, country: o.market, countryLabel: o.marketLabel, body: o.bodyType || "", bodyLabel: o.bodyLabel, mileageKm: o.mileageKm, mileage: o.mileageKm ? `${money(o.mileageKm)} км` : "пробег уточняется", engine: o.engineCc ? `${o.engineCc} см³` : `${o.fuelLabel}`, power: o.powerHp ? `${o.powerHp} л.с.` : "мощность уточняется", images: o.images, calculationSnapshot: o.calculationSnapshot };
        }));
      }).catch(() => setOffers([]));
  }, []);

  const budgetNumber = Number(budget) || 0;
  const calculatorOffers = useMemo(() => offers.filter((offer) => {
    if (budgetNumber && offer.price > budgetNumber) return false;
    if (brand && offer.brand.toLowerCase() !== brand.toLowerCase()) return false;
    if (model && !offer.title.toLowerCase().includes(model.toLowerCase())) return false;
    if (year === "older" && offer.year >= 2018) return false;
    if (year && year !== "older" && offer.year < Number(year)) return false;
    if (market && offer.country !== market) return false;
    if (body && offer.body !== body) return false;
    return true;
  }), [offers, budgetNumber, brand, model, year, market, body]);

  const catalogOffers = useMemo(() => offers.filter((offer) => {
    if (catalogMarket && offer.country !== catalogMarket) return false;
    if (catalogMake && !offer.title.toLowerCase().includes(catalogMake.toLowerCase())) return false;
    return true;
  }), [offers, catalogMarket, catalogMake]);

  function buildResultsUrl(extra?: Partial<HomeOffer>) {
    const params = new URLSearchParams();
    const finalBudget = extra?.price || budgetNumber;
    const finalBrand = extra?.brand || brand;
    const finalModel = extra?.model || model;
    const finalYear: string | number = extra?.year || year;
    const finalMarket = extra?.country || market;
    const finalBody = extra?.body || body;
    if (finalBudget) params.set("budget", String(finalBudget));
    if (finalBrand) params.set("brand", finalBrand);
    if (finalModel) params.set("model", finalModel);
    if (finalYear === "older") params.set("yearTo", "2017"); else if (finalYear) params.set("yearFrom", String(finalYear));
    if (finalMarket) params.set("market", finalMarket);
    if (finalBody) params.set("body", finalBody);
    appendAttributionToSearchParams(params);
    return `/results?${params.toString()}`;
  }

  return (
    <main className="min-h-screen bg-[#07080d] text-white">
      <PublicHeader />
      <Link href="/cars" className="sr-only">Каталог</Link>
      <div className="mx-auto w-full max-w-[1500px] px-4 pb-16 md:px-8">
        <section className="grid items-start gap-7 py-7 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-10 lg:py-12">
          <div><h1 className="max-w-4xl text-[44px] font-black leading-[.93] tracking-[-0.055em] sm:text-[64px] lg:text-[82px] xl:text-[96px]">Цена на авто под заказ</h1><p className="mt-5 text-lg font-medium text-white/75 md:text-xl">Укажите бюджет — покажем, что можно привезти под ключ.</p><div className="mt-7 hidden grid-cols-1 gap-4 lg:grid">{benefits.map((item) => <div key={item.title} className="flex items-center gap-4"><div className="flex h-11 w-11 items-center justify-center rounded-xl border border-red-400/25 bg-red-500/10 text-xl text-red-400">{item.icon}</div><div><div className="font-black">{item.title}</div><div className="mt-1 text-sm text-white/45">{item.text}</div></div></div>)}</div></div>
          <Calculator budget={budget} setBudget={setBudget} brand={brand} setBrand={setBrand} model={model} setModel={setModel} year={year} setYear={setYear} market={market} setMarket={setMarket} body={body} setBody={setBody} foundCount={calculatorOffers.length} submit={() => router.push(buildResultsUrl())} />
        </section>
        <div className="grid grid-cols-3 gap-3 border-y border-white/8 py-5 lg:hidden">{benefits.map((item) => <div key={item.title} className="text-center"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-red-500/12 text-xl text-red-400">{item.icon}</div><div className="mt-2 text-sm font-black">{item.title}</div></div>)}</div>
        <section className="mt-8"><BuyerGallery /><ExecutorBlock /></section>
        <section className="mt-6 border-t border-red-500/45 pt-6" data-demo-enabled={allowDemo ? "true" : "false"}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><div className="text-xs font-black uppercase tracking-[0.18em] text-red-300">Свежие предложения</div><h2 className="mt-2 text-3xl font-black tracking-[-0.04em] md:text-5xl">Автомобили в каталоге</h2></div><div className="grid gap-3 sm:grid-cols-[180px_220px_auto]"><SelectBox value={catalogMarket} onChange={setCatalogMarket} ariaLabel="Фильтр по стране">{marketOptions.map((item) => <option key={item.value || "any"} value={item.value}>{item.label}</option>)}</SelectBox><input value={catalogMake} onChange={(event) => setCatalogMake(event.target.value)} placeholder="Марка или модель" className="soft-input h-14 rounded-2xl bg-[#181a21] px-4 text-sm font-bold outline-none" /><Link href="/cars" className="avto-button flex h-14 items-center justify-center rounded-2xl px-5 font-black">Смотреть все</Link></div></div>
          {catalogOffers.length ? <div className="ac-hide-scrollbar mt-6 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3 md:grid md:grid-cols-2 md:overflow-visible lg:grid-cols-3">{catalogOffers.slice(0, 6).map((offer) => <OfferCard key={offer.id} offer={offer} onOpen={setSelectedOffer} />)}</div> : <div className="mt-6 rounded-[1.6rem] bg-white/[0.045] p-6 text-sm font-bold text-white/58">Каталог обновляется. Оставьте заявку — менеджер подберёт автомобиль.</div>}
        </section>
      </div>
      <OfferModal offer={selectedOffer} onClose={() => setSelectedOffer(null)} onRequest={(offer) => router.push(buildResultsUrl(offer))} />
    </main>
  );
}
