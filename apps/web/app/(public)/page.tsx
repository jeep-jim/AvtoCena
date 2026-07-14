"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
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
  { value: "wagon", label: "Универсал" },
  { value: "hatchback", label: "Хэтчбек" },
  { value: "liftback", label: "Лифтбек" },
  { value: "coupe", label: "Купе" },
  { value: "convertible", label: "Кабриолет" },
  { value: "minivan", label: "Минивэн" },
  { value: "pickup", label: "Пикап" },
  { value: "van", label: "Фургон" },
];
const brandOptions = ["", "Toyota", "Honda", "Hyundai", "Kia", "Chevrolet", "Mercedes-Benz", "BMW", "Audi", "Lexus", "Genesis", "KGM"];
const buyerPhotos = Array.from({ length: 15 }, (_, index) => ({ src: `/buyers/${index + 1}.jpg`, alt: `Клиент TopAvto ${index + 1}` }));
const benefits = [
  { icon: "fast", title: "Без регистрации", text: "Сразу получите первую выдачу по вашему бюджету." },
  { icon: "markets", title: "5 рынков", text: "Япония, Китай, Корея, ОАЭ и Европа в одном подборе." },
  { icon: "delivery", title: "Под ключ", text: "Доставка, таможня и оформление входят в структуру расчёта." },
];

type SelectOption = { value: string; label: string };

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

function Chevron() {
  return <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M5 7L9 11L13 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function SearchIcon() {
  return <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.7" /><path d="M12 12L16 16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
}

function BenefitIcon({ type }: { type: string }) {
  if (type === "fast") return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13.5 2L5 13H11L10.5 22L19 10.5H13L13.5 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (type === "markets") return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" /><path d="M3.8 12H20.2M12 3.5C14.2 5.8 15.4 8.6 15.4 12C15.4 15.4 14.2 18.2 12 20.5C9.8 18.2 8.6 15.4 8.6 12C8.6 8.6 9.8 5.8 12 3.5Z" stroke="currentColor" strokeWidth="1.7" /></svg>;
  return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 7H15V17H3V7ZM15 10H19L22 13V17H15V10Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><circle cx="7" cy="18" r="2" stroke="currentColor" strokeWidth="2" /><circle cx="18" cy="18" r="2" stroke="currentColor" strokeWidth="2" /></svg>;
}

function SelectBox({ value, onChange, children, ariaLabel }: { value: string; onChange: (value: string) => void; children: React.ReactNode; ariaLabel: string }) {
  return (
    <label className="relative min-w-0">
      <span className="sr-only">{ariaLabel}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="ac-native-select soft-input h-14 w-full rounded-2xl px-4 text-sm font-black text-white outline-none">
        {children}
      </select>
    </label>
  );
}

function SearchSelect({ value, onChange, options, placeholder, searchPlaceholder }: { value: string; onChange: (value: string) => void; options: SelectOption[]; placeholder: string; searchPlaceholder: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = options.find((item) => item.value === value);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru-RU");
    if (!normalized) return options;
    return options.filter((item) => item.label.toLocaleLowerCase("ru-RU").includes(normalized));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  function select(next: string) {
    onChange(next);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={rootRef} className={`relative min-w-0 ${open ? "z-[180]" : "z-0"}`}>
      <button type="button" onClick={() => setOpen((current) => !current)} className={`ac-search-select soft-input flex h-14 w-full min-w-0 items-center justify-between gap-2 rounded-2xl px-4 text-left text-sm font-black transition ${open ? "rounded-b-none ring-2 ring-red-500/35" : ""}`} aria-expanded={open} aria-haspopup="listbox">
        <span className={`min-w-0 truncate ${selected?.value ? "text-white" : "text-white/70"}`}>{selected?.label || placeholder}</span>
        <span className={`shrink-0 text-white/46 transition ${open ? "rotate-180" : ""}`}><Chevron /></span>
      </button>

      {open ? (
        <div className="ac-search-menu absolute left-0 right-0 top-[calc(100%-1px)] z-[180] overflow-hidden rounded-b-2xl bg-[#171922] shadow-[0_24px_80px_rgba(0,0,0,.72)]">
          <div className="p-2.5">
            <div className="ac-search-box flex h-10 items-center gap-2 rounded-xl bg-white/[0.065] px-3 text-white/45 ring-1 ring-white/10 focus-within:ring-red-400/55">
              <SearchIcon />
              <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} className="min-w-0 flex-1 bg-transparent text-sm font-bold text-white outline-none placeholder:text-white/28" />
              {query ? <button type="button" onClick={() => setQuery("")} className="flex h-6 w-6 items-center justify-center rounded-full text-white/45 hover:bg-white/10 hover:text-white" aria-label="Очистить поиск">×</button> : null}
            </div>
          </div>
          <div className="ac-hide-scrollbar max-h-[270px] overflow-y-auto overscroll-contain p-1.5 pt-0" role="listbox">
            {filtered.length ? filtered.map((item) => {
              const active = item.value === value;
              return (
                <button key={item.value || "any"} type="button" role="option" aria-selected={active} onClick={() => select(item.value)} className={`flex min-h-10 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm font-bold transition ${active ? "bg-red-500 text-white shadow-[0_8px_24px_rgba(239,68,68,.18)]" : "text-white/78 hover:bg-white/[0.07] hover:text-white"}`}>
                  <span className="min-w-0 truncate">{item.label}</span>
                  {active ? <svg width="15" height="12" viewBox="0 0 15 12" fill="none" aria-hidden="true"><path d="M1.5 6.2L5.2 10L13.5 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}
                </button>
              );
            }) : <div className="px-3 py-6 text-center text-sm font-bold text-white/40">Ничего не найдено</div>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BodyIcon({ type }: { type: string }) {
  const roof = type === "sedan" ? "M9 14L15 8H34L42 14" : type === "pickup" ? "M8 14L14 9H29L34 14H48" : type === "minivan" || type === "van" ? "M8 14L12 7H42L48 14" : "M8 14L15 8H38L46 14";
  return (
    <svg width="48" height="27" viewBox="0 0 56 30" fill="none" aria-hidden="true">
      <path d={roof} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 15H49C51 15 52 16.5 52 18.5V21H4V18C4 16.3 4.8 15.3 6 15Z" fill="currentColor" fillOpacity=".08" stroke="currentColor" strokeWidth="2" />
      <circle cx="15" cy="22" r="4" fill="#12141b" stroke="currentColor" strokeWidth="2" />
      <circle cx="43" cy="22" r="4" fill="#12141b" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function BodyPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = bodyOptions.find((item) => item.value === value) || bodyOptions[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${open ? "z-[170]" : "z-0"}`}>
      <button type="button" onClick={() => setOpen((current) => !current)} className="soft-input flex h-14 w-full items-center justify-between rounded-2xl px-4 text-left text-sm font-black text-white">
        <span>{selected.label}</span><span className={`text-white/45 transition ${open ? "rotate-180" : ""}`}><Chevron /></span>
      </button>
      {open ? (
        <div className="ac-search-menu absolute left-0 right-0 top-[calc(100%+8px)] z-[170] grid grid-cols-3 gap-1.5 rounded-[1.35rem] bg-[#151820] p-2.5 shadow-[0_24px_80px_rgba(0,0,0,.62)]">
          {bodyOptions.map((item) => (
            <button key={item.value || "any"} type="button" onClick={() => { onChange(item.value); setOpen(false); }} className={`flex min-h-[78px] flex-col items-center justify-center rounded-xl px-1.5 py-2 text-center text-[10px] font-black transition ${item.value === value ? "bg-red-500/16 text-red-400" : "text-white/78 hover:bg-white/[0.055]"}`}>
              <BodyIcon type={item.value} /><span className="mt-1 leading-tight">{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Calculator({ budget, setBudget, brand, setBrand, model, setModel, modelOptions, year, setYear, market, setMarket, body, setBody, foundCount, submit }: any) {
  const brandSelectOptions = brandOptions.map((item) => ({ value: item, label: item || "Любая марка" }));

  return (
    <div id="form" className="ac-filter-panel rounded-[1.8rem] bg-white/[0.075] p-4 shadow-[0_25px_90px_rgba(227,27,35,.14)] backdrop-blur-xl md:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-xs font-black uppercase tracking-[0.16em] text-red-200">Бюджет</div>
        <div className="rounded-full bg-black/18 px-3 py-1.5 text-[11px] font-black text-white/72">🚗 Нашли {foundCount} вариантов</div>
      </div>
      <SelectBox value={budget} onChange={setBudget} ariaLabel="Бюджет">
        {budgetOptions.map((item) => <option key={item} value={item}>до {money(item)} ₽</option>)}
      </SelectBox>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <SearchSelect value={brand} onChange={(next) => { setBrand(next); setModel(""); }} options={brandSelectOptions} placeholder="Любая марка" searchPlaceholder="Найти марку" />
        <SearchSelect value={model} onChange={setModel} options={modelOptions} placeholder="Любая модель" searchPlaceholder="Найти модель" />
        <SelectBox value={year} onChange={setYear} ariaLabel="Год">
          {yearOptions.map((item) => <option key={item.value || "any"} value={item.value}>{item.label}</option>)}
        </SelectBox>
        <SelectBox value={market} onChange={setMarket} ariaLabel="Страна">
          {marketOptions.map((item) => <option key={item.value || "any"} value={item.value}>{item.label}</option>)}
        </SelectBox>
        <div className="col-span-2"><BodyPicker value={body} onChange={setBody} /></div>
      </div>
      <button type="button" onClick={submit} className="avto-button mt-4 flex h-[58px] w-full items-center justify-center gap-3 rounded-2xl text-base font-black">
        <span className="ac-pulse-dot" aria-hidden="true"><span /></span> Узнать АвтоЦену
      </button>
    </div>
  );
}

function BuyerGallery() {
  const photos = [...buyerPhotos, ...buyerPhotos];
  return (
    <section className="overflow-hidden">
      <h2 className="text-3xl font-black tracking-[-0.04em] md:text-5xl">Те, кто узнали — уже ездят!</h2>
      <div className="buyer-gallery-mask mt-5 overflow-hidden">
        <div className="buyer-gallery-track flex w-max gap-3 md:gap-4">
          {photos.map((photo, index) => (
            <div key={`${photo.src}-${index}`} className="h-[150px] w-[220px] shrink-0 overflow-hidden rounded-[1.35rem] bg-white/[0.04] shadow-[0_15px_50px_rgba(0,0,0,.18)] sm:h-[180px] sm:w-[270px] lg:h-[205px] lg:w-[315px]">
              <img src={photo.src} alt={photo.alt} className="h-full w-full object-cover" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ExecutorBlock() {
  return (
    <section className="mt-4 grid gap-5 rounded-[1.6rem] bg-white/[0.04] p-5 shadow-[0_15px_55px_rgba(0,0,0,.14)] md:grid-cols-[minmax(0,1fr)_290px] md:items-center md:p-6">
      <div>
        <h3 className="text-xl font-black">АвтоЦена — подбор автомобиля под ваш бюджет</h3>
        <p className="mt-3 max-w-4xl text-sm font-medium leading-7 text-white/58 md:text-[15px]">Сервис помогает быстро понять, какой автомобиль можно привезти из Японии, Китая, Кореи, ОАЭ или Европы. Вы задаёте базовые параметры, а система показывает реальные варианты для следующего шага с менеджером TopAvto.</p>
      </div>
      <div className="flex min-h-32 items-center justify-center rounded-[1.3rem] bg-black/18 p-5">
        <img src="/brands/topavto-logo.png" alt="TopAvto" className="max-h-24 w-full object-contain" />
      </div>
    </section>
  );
}

function OfferCard({ offer, onOpen }: { offer: HomeOffer; onOpen: (offer: HomeOffer) => void }) {
  const imageUrl = offer.images[0];
  return (
    <article className="ac-catalog-card relative w-[84vw] max-w-[360px] shrink-0 snap-start overflow-hidden rounded-[1.5rem] bg-white/[0.05] md:w-auto md:max-w-none">
      <button type="button" onClick={() => onOpen(offer)} className="block w-full text-left">
        <div className="relative h-56 overflow-hidden bg-white/[0.04]">
          {imageUrl ? <img src={imageUrl} alt={offer.title} className="h-full w-full object-cover object-[center_38%]" /> : <div className="flex h-full items-center justify-center text-white/35">Фото загружается</div>}
          <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/90 via-black/45 to-transparent" />
          <div className="ac-on-image absolute left-3 top-3 rounded-full bg-black/38 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-white backdrop-blur">{offer.countryLabel}</div>
          <div className="ac-on-image absolute bottom-3 left-3 right-3 text-white">
            <div className="line-clamp-2 max-w-[86%] text-[19px] font-black leading-[1.08] tracking-[-0.03em] drop-shadow-[0_2px_16px_rgba(0,0,0,.75)]">{offer.title}</div>
            <div className="mt-2 flex gap-2 text-[11px] font-black text-white/85"><span className="rounded-full bg-black/40 px-3 py-1 backdrop-blur">{offer.year}</span><span className="rounded-full bg-black/40 px-3 py-1 backdrop-blur">{offer.mileage}</span></div>
          </div>
        </div>
        <div className="p-4">
          <div className="flex items-end justify-between gap-3"><div><div className="text-[10px] font-black uppercase tracking-[0.16em] text-red-300/72">Ориентир</div><div className="mt-1 text-2xl font-black tracking-[-0.04em] text-red-300">{money(offer.price)} ₽</div></div><span className="rounded-xl bg-white/[0.07] px-3 py-2 text-xs font-black">Подробнее</span></div>
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
  return <div className="grid gap-2.5 text-sm font-bold text-white/68">{lines.map(([label, amount]) => <div key={label} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-2"><span className="text-red-300/65">·</span><span className="flex min-w-0 items-baseline gap-2"><span className="shrink-0">{label}</span><span className="mb-1 min-w-5 flex-1 border-b border-dotted border-white/8" /></span><span className="min-w-[105px] text-right font-black text-white">{money(amount)} ₽</span></div>)}</div>;
}

function OfferModal({ offer, onClose, onRequest }: { offer: HomeOffer | null; onClose: () => void; onRequest: (offer: HomeOffer) => void }) {
  const [photoIndex, setPhotoIndex] = useState(0);
  useEffect(() => setPhotoIndex(0), [offer?.id]);
  useEffect(() => {
    if (!offer) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", close); };
  }, [offer, onClose]);
  if (!offer || typeof document === "undefined") return null;
  const images = offer.images.length ? offer.images : [""];
  const previous = () => setPhotoIndex((current) => current === 0 ? images.length - 1 : current - 1);
  const next = () => setPhotoIndex((current) => (current + 1) % images.length);
  return createPortal(
    <div className="fixed inset-0 z-[9998] flex items-end justify-center bg-black/82 backdrop-blur-[8px] md:items-center md:p-5" role="dialog" aria-modal="true">
      <button type="button" onClick={onClose} className="absolute inset-0" aria-label="Закрыть" />
      <div className="ac-offer-panel relative z-10 max-h-[100dvh] w-full overflow-y-auto bg-[#0b0d14] md:max-h-[calc(100dvh-40px)] md:max-w-5xl md:rounded-[2rem]">
        <div className="relative h-[330px] overflow-hidden sm:h-[430px]">
          {images[photoIndex] ? <img src={images[photoIndex]} alt={offer.title} className="h-full w-full object-cover object-[center_30%]" /> : null}
          <div className="absolute inset-x-0 bottom-0 h-[44%] bg-gradient-to-t from-[#0b0d14] via-[#0b0d14]/52 to-transparent" />
          <div className="ac-on-image absolute left-4 top-4 flex flex-wrap gap-2 text-white sm:left-6 sm:top-6"><span className="rounded-full bg-red-500 px-3 py-1 text-xs font-black">{offer.countryLabel}</span><span className="rounded-full bg-black/40 px-3 py-1 text-xs font-black backdrop-blur">{offer.bodyLabel}</span><span className="rounded-full bg-black/40 px-3 py-1 text-xs font-black backdrop-blur">{offer.year}</span></div>
          <button type="button" onClick={onClose} className="ac-on-image absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-xl bg-black/55 text-white backdrop-blur sm:right-6 sm:top-6" aria-label="Закрыть"><svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 3L15 15M15 3L3 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg></button>
          {images.length > 1 ? <><button type="button" onClick={previous} className="ac-on-image absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl bg-black/50 text-2xl text-white backdrop-blur">‹</button><button type="button" onClick={next} className="ac-on-image absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl bg-black/50 text-2xl text-white backdrop-blur">›</button></> : null}
          <div className="ac-on-image absolute bottom-5 left-4 right-4 text-white sm:bottom-7 sm:left-7 sm:right-7"><h2 className="max-w-3xl text-[28px] font-black leading-[.98] tracking-[-0.045em] sm:text-[44px]">{offer.title}</h2><div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-white/68"><span>{offer.engine}</span><span>·</span><span>{offer.power}</span></div></div>
        </div>
        {images.length > 1 ? <div className="ac-hide-scrollbar flex gap-2 overflow-x-auto px-4 pt-3 sm:px-6">{images.map((image, index) => <button key={`${image}-${index}`} type="button" onClick={() => setPhotoIndex(index)} className={`h-16 w-24 shrink-0 overflow-hidden rounded-xl ${index === photoIndex ? "ring-2 ring-red-400" : "opacity-55"}`}><img src={image} alt="" className="h-full w-full object-cover" /></button>)}</div> : null}
        <div className="grid gap-6 p-5 sm:p-7 md:grid-cols-[minmax(0,1fr)_310px]"><div><p className="text-sm font-medium leading-7 text-white/58">Ориентировочная структура цены. Финальная стоимость зависит от курса, состояния автомобиля, даты покупки, логистики и города доставки.</p><div className="mt-5"><CostLines offer={offer} /></div></div><div className="rounded-[1.4rem] bg-white/[0.035] p-5"><div className="text-xs font-black uppercase tracking-[0.18em] text-red-300/75">Ориентир цены</div><div className="mt-2 text-4xl font-black tracking-[-0.05em]">{money(offer.price)} ₽</div><div className="mt-1 text-sm font-black text-emerald-300">по текущему варианту</div><button type="button" onClick={() => onRequest(offer)} className="avto-button mt-6 h-14 w-full rounded-2xl font-black">Получить предложение</button><Link href={`/cars/offer/${offer.id}`} className="mt-3 block rounded-2xl bg-white/[0.06] px-5 py-4 text-center font-black">Открыть карточку</Link></div></div>
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
    fetch("/api/catalog/search?pageSize=30&sort=updatedAt", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        const items = Array.isArray(data?.items) ? data.items : [];
        setOffers(items.slice(0, 30).map((raw: any) => {
          const o = presentCatalogOffer(raw);
          return { id: o.id, title: o.title, brand: o.makeLabel, model: o.modelLabel, year: o.year, price: o.totalRub || 0, country: o.market, countryLabel: o.marketLabel, body: o.bodyType || "", bodyLabel: o.bodyLabel, mileageKm: o.mileageKm, mileage: o.mileageKm ? `${money(o.mileageKm)} км` : "пробег уточняется", engine: o.engineCc ? `${o.engineCc} см³` : `${o.fuelLabel}`, power: o.powerHp ? `${o.powerHp} л.с.` : "мощность уточняется", images: o.images, calculationSnapshot: o.calculationSnapshot };
        }));
      }).catch(() => setOffers([]));
  }, []);

  const modelOptions = useMemo<SelectOption[]>(() => {
    const pool = brand ? offers.filter((offer) => offer.brand.toLowerCase() === brand.toLowerCase()) : offers;
    const models = Array.from(new Set(pool.map((offer) => offer.model).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ru"));
    return [{ value: "", label: "Любая модель" }, ...models.map((item) => ({ value: item, label: item }))];
  }, [offers, brand]);

  const budgetNumber = Number(budget) || 0;
  const calculatorOffers = useMemo(() => offers.filter((offer) => {
    if (budgetNumber && offer.price > budgetNumber) return false;
    if (brand && offer.brand.toLowerCase() !== brand.toLowerCase()) return false;
    if (model && offer.model.toLowerCase() !== model.toLowerCase() && !offer.title.toLowerCase().includes(model.toLowerCase())) return false;
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
    <main className="ac-page-copy min-h-screen overflow-x-hidden bg-[#07080d] text-white">
      <PublicHeader />
      <Link href="/cars" className="sr-only">Каталог</Link>
      <div className="mx-auto w-full max-w-[1500px] px-4 pb-16 md:px-8">
        <section className="grid items-start gap-7 py-7 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-10 lg:py-12">
          <div>
            <h1 className="max-w-4xl text-[44px] font-black leading-[.93] tracking-[-0.055em] sm:text-[64px] lg:text-[82px] xl:text-[96px]">Цена на авто под заказ</h1>
            <p className="mt-5 text-lg font-medium text-white/75 md:text-xl">Укажите бюджет — покажем, что можно привезти под ключ.</p>
            <div className="mt-7 hidden grid-cols-1 gap-4 lg:grid">{benefits.map((item) => <div key={item.title} className="flex items-center gap-4"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-500/10 text-red-400"><BenefitIcon type={item.icon} /></div><div><div className="font-black">{item.title}</div><div className="mt-1 text-sm text-white/45">{item.text}</div></div></div>)}</div>
          </div>
          <Calculator budget={budget} setBudget={setBudget} brand={brand} setBrand={setBrand} model={model} setModel={setModel} modelOptions={modelOptions} year={year} setYear={setYear} market={market} setMarket={setMarket} body={body} setBody={setBody} foundCount={calculatorOffers.length} submit={() => router.push(buildResultsUrl())} />
        </section>

        <div className="grid grid-cols-3 gap-3 rounded-[1.4rem] bg-white/[0.025] px-2 py-5 lg:hidden">{benefits.map((item) => <div key={item.title} className="text-center"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-red-500/12 text-red-400"><BenefitIcon type={item.icon} /></div><div className="mt-2 text-sm font-black">{item.title}</div></div>)}</div>
        <section className="mt-8"><BuyerGallery /><ExecutorBlock /></section>

        <section className="mt-6 pt-6" data-demo-enabled={allowDemo ? "true" : "false"}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div><div className="text-xs font-black uppercase tracking-[0.18em] text-red-300">Свежие предложения</div><h2 className="mt-2 text-3xl font-black tracking-[-0.04em] md:text-5xl">Автомобили в каталоге</h2></div>
            <div className="grid gap-3 sm:grid-cols-[180px_220px_auto]"><SelectBox value={catalogMarket} onChange={setCatalogMarket} ariaLabel="Фильтр по стране">{marketOptions.map((item) => <option key={item.value || "any"} value={item.value}>{item.label}</option>)}</SelectBox><input value={catalogMake} onChange={(event) => setCatalogMake(event.target.value)} placeholder="Марка или модель" className="ac-filter-input soft-input h-14 rounded-2xl bg-[#181a21] px-4 text-sm font-bold outline-none" /><Link href="/cars" className="avto-button flex h-14 items-center justify-center rounded-2xl px-5 font-black">Смотреть все</Link></div>
          </div>
          {catalogOffers.length ? <div className="ac-hide-scrollbar mt-6 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3 md:grid md:grid-cols-2 md:overflow-visible lg:grid-cols-3">{catalogOffers.slice(0, 6).map((offer) => <OfferCard key={offer.id} offer={offer} onOpen={setSelectedOffer} />)}</div> : <div className="mt-6 rounded-[1.6rem] bg-white/[0.045] p-6 text-sm font-bold text-white/58">Каталог обновляется. Оставьте заявку — менеджер подберёт автомобиль.</div>}
        </section>
      </div>
      <OfferModal offer={selectedOffer} onClose={() => setSelectedOffer(null)} onRequest={(offer) => router.push(buildResultsUrl(offer))} />
    </main>
  );
}
