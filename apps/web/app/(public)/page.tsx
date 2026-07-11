"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/brand/BrandMark";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";

const budgetChips = [1500000, 2000000, 2500000, 3000000, 4000000, 5000000];

const brandOptions = [
  { value: "", label: "Марка" },
  { value: "Toyota", label: "Toyota" },
  { value: "Honda", label: "Honda" },
  { value: "BMW", label: "BMW" },
  { value: "Audi", label: "Audi" },
  { value: "Kia", label: "Kia" },
  { value: "Hyundai", label: "Hyundai" },
  { value: "Lexus", label: "Lexus" },
];

const modelOptions = [
  { value: "", label: "Модель", brand: "" },
  { value: "Harrier", label: "Harrier", brand: "Toyota" },
  { value: "Camry", label: "Camry", brand: "Toyota" },
  { value: "Vezel", label: "Vezel", brand: "Honda" },
  { value: "A3 Sportback", label: "A3 Sportback", brand: "Audi" },
  { value: "K5", label: "K5", brand: "Kia" },
  { value: "320", label: "320", brand: "BMW" },
];

const yearOptions = [
  { value: "", label: "Год от" },
  { value: "2018", label: "2018" },
  { value: "2019", label: "2019" },
  { value: "2020", label: "2020" },
  { value: "2021", label: "2021" },
  { value: "2022", label: "2022" },
  { value: "2023", label: "2023" },
  { value: "2024", label: "2024" },
];

const countryOptions = [
  { value: "", label: "Страна" },
  { value: "japan", label: "Япония" },
  { value: "china", label: "Китай" },
  { value: "korea", label: "Корея" },
  { value: "uae", label: "ОАЭ" },
  { value: "europe", label: "Европа" },
];

const bodyOptions = [
  { value: "", label: "Тип кузова" },
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

type BenefitType = "fast" | "globe" | "delivery";

type CatalogOffer = {
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
  mileage: string;
  engine: string;
  power: string;
  delivery: string;
  sourceLabel: string;
};

const landingBenefits: {
  id: string;
  icon: BenefitType;
  title: string;
  shortTitle: string;
  text: string;
}[] = [
  {
    id: "fast",
    icon: "fast",
    title: "Без регистрации",
    shortTitle: "Без регистрации",
    text: "Сразу получите первую выдачу по вашему бюджету.",
  },
  {
    id: "markets",
    icon: "globe",
    title: "Япония · Китай · Корея · ОАЭ · Европа",
    shortTitle: "5 рынков",
    text: "Сравниваем основные рынки поставки и показываем варианты.",
  },
  {
    id: "delivery",
    icon: "delivery",
    title: "Доставка, таможня и оформление",
    shortTitle: "Под ключ",
    text: "В расчёт включается ключевая структура цены и оформления.",
  },
];

const buyerPhotos = Array.from({ length: 15 }, (_, index) => ({
  src: `/buyers/${index + 1}.jpg`,
  alt: `Автомобиль клиента TopAvto ${index + 1}`,
}));

const readyCatalog: CatalogOffer[] = [
  {
    id: "harrier-2021-jp",
    title: "Toyota Harrier Hybrid",
    brand: "Toyota",
    model: "Harrier",
    year: 2021,
    price: 2950000,
    country: "japan",
    countryLabel: "Япония",
    body: "suv",
    bodyLabel: "Кроссовер",
    mileage: "42 000 км",
    engine: "2.5 Hybrid",
    power: "178 л.с.",
    delivery: "под ключ",
    sourceLabel: "из Telegram-ленты",
  },
  {
    id: "vezel-2021-jp",
    title: "Honda Vezel e:HEV",
    brand: "Honda",
    model: "Vezel",
    year: 2021,
    price: 2180000,
    country: "japan",
    countryLabel: "Япония",
    body: "suv",
    bodyLabel: "Кроссовер",
    mileage: "38 000 км",
    engine: "1.5 Hybrid",
    power: "131 л.с.",
    delivery: "под ключ",
    sourceLabel: "из Telegram-ленты",
  },
  {
    id: "camry-2020-uae",
    title: "Toyota Camry 2.5",
    brand: "Toyota",
    model: "Camry",
    year: 2020,
    price: 2860000,
    country: "uae",
    countryLabel: "ОАЭ",
    body: "sedan",
    bodyLabel: "Седан",
    mileage: "64 000 км",
    engine: "2.5 бензин",
    power: "181 л.с.",
    delivery: "под ключ",
    sourceLabel: "из Telegram-ленты",
  },
  {
    id: "a3-2021-eu",
    title: "Audi A3 Sportback",
    brand: "Audi",
    model: "A3 Sportback",
    year: 2021,
    price: 2740000,
    country: "europe",
    countryLabel: "Европа",
    body: "hatchback",
    bodyLabel: "Хэтчбек",
    mileage: "51 000 км",
    engine: "1.4 TFSI",
    power: "150 л.с.",
    delivery: "под ключ",
    sourceLabel: "из Telegram-ленты",
  },
  {
    id: "k5-2021-kr",
    title: "Kia K5 Prestige",
    brand: "Kia",
    model: "K5",
    year: 2021,
    price: 2360000,
    country: "korea",
    countryLabel: "Корея",
    body: "sedan",
    bodyLabel: "Седан",
    mileage: "49 000 км",
    engine: "2.0 бензин",
    power: "150 л.с.",
    delivery: "под ключ",
    sourceLabel: "из Telegram-ленты",
  },
  {
    id: "bmw-320-2020-eu",
    title: "BMW 320i G20",
    brand: "BMW",
    model: "320",
    year: 2020,
    price: 2990000,
    country: "europe",
    countryLabel: "Европа",
    body: "sedan",
    bodyLabel: "Седан",
    mileage: "72 000 км",
    engine: "2.0 бензин",
    power: "184 л.с.",
    delivery: "под ключ",
    sourceLabel: "из Telegram-ленты",
  },
  {
    id: "lexus-ux-2020-jp",
    title: "Lexus UX 250h",
    brand: "Lexus",
    model: "UX",
    year: 2020,
    price: 2920000,
    country: "japan",
    countryLabel: "Япония",
    body: "suv",
    bodyLabel: "Кроссовер",
    mileage: "58 000 км",
    engine: "2.0 Hybrid",
    power: "184 л.с.",
    delivery: "под ключ",
    sourceLabel: "из Telegram-ленты",
  },
  {
    id: "tucson-2021-kr",
    title: "Hyundai Tucson",
    brand: "Hyundai",
    model: "Tucson",
    year: 2021,
    price: 2480000,
    country: "korea",
    countryLabel: "Корея",
    body: "suv",
    bodyLabel: "Кроссовер",
    mileage: "46 000 км",
    engine: "2.0 бензин",
    power: "150 л.с.",
    delivery: "под ключ",
    sourceLabel: "из Telegram-ленты",
  },
  {
    id: "corolla-2022-jp",
    title: "Toyota Corolla Touring",
    brand: "Toyota",
    model: "Corolla",
    year: 2022,
    price: 1920000,
    country: "japan",
    countryLabel: "Япония",
    body: "wagon",
    bodyLabel: "Универсал",
    mileage: "35 000 км",
    engine: "1.8 Hybrid",
    power: "122 л.с.",
    delivery: "под ключ",
    sourceLabel: "из Telegram-ленты",
  },
  {
    id: "civic-2021-jp",
    title: "Honda Civic Hatchback",
    brand: "Honda",
    model: "Civic",
    year: 2021,
    price: 2270000,
    country: "japan",
    countryLabel: "Япония",
    body: "hatchback",
    bodyLabel: "Хэтчбек",
    mileage: "44 000 км",
    engine: "1.5 Turbo",
    power: "182 л.с.",
    delivery: "под ключ",
    sourceLabel: "из Telegram-ленты",
  },
  {
    id: "sportage-2020-kr",
    title: "Kia Sportage",
    brand: "Kia",
    model: "Sportage",
    year: 2020,
    price: 2190000,
    country: "korea",
    countryLabel: "Корея",
    body: "suv",
    bodyLabel: "Кроссовер",
    mileage: "67 000 км",
    engine: "2.0 бензин",
    power: "150 л.с.",
    delivery: "под ключ",
    sourceLabel: "из Telegram-ленты",
  },
  {
    id: "elantra-2022-kr",
    title: "Hyundai Elantra",
    brand: "Hyundai",
    model: "Elantra",
    year: 2022,
    price: 1980000,
    country: "korea",
    countryLabel: "Корея",
    body: "sedan",
    bodyLabel: "Седан",
    mileage: "31 000 км",
    engine: "1.6 бензин",
    power: "123 л.с.",
    delivery: "под ключ",
    sourceLabel: "из Telegram-ленты",
  },
  {
    id: "x-trail-2021-jp",
    title: "Nissan X-Trail e-Power",
    brand: "Nissan",
    model: "X-Trail",
    year: 2021,
    price: 2690000,
    country: "japan",
    countryLabel: "Япония",
    body: "suv",
    bodyLabel: "Кроссовер",
    mileage: "53 000 км",
    engine: "e-Power",
    power: "204 л.с.",
    delivery: "под ключ",
    sourceLabel: "из Telegram-ленты",
  },
  {
    id: "mazda3-2020-jp",
    title: "Mazda 3 Fastback",
    brand: "Mazda",
    model: "Mazda 3",
    year: 2020,
    price: 2060000,
    country: "japan",
    countryLabel: "Япония",
    body: "hatchback",
    bodyLabel: "Хэтчбек",
    mileage: "57 000 км",
    engine: "2.0 бензин",
    power: "156 л.с.",
    delivery: "под ключ",
    sourceLabel: "из Telegram-ленты",
  },
  {
    id: "song-plus-2022-cn",
    title: "BYD Song Plus DM-i",
    brand: "BYD",
    model: "Song Plus",
    year: 2022,
    price: 2470000,
    country: "china",
    countryLabel: "Китай",
    body: "suv",
    bodyLabel: "Кроссовер",
    mileage: "29 000 км",
    engine: "PHEV",
    power: "197 л.с.",
    delivery: "под ключ",
    sourceLabel: "из Telegram-ленты",
  },
];

function formatMoney(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function pluralVariant(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) return "вариант";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14))
    return "варианта";

  return "вариантов";
}

function getFilteredCatalogOffers({
  budgetNumber,
  brand,
  model,
  yearFrom,
  country,
  bodyType,
}: {
  budgetNumber: number;
  brand: string;
  model: string;
  yearFrom: string;
  country: string;
  bodyType: string;
}) {
  return readyCatalog.filter((offer) => {
    if (budgetNumber > 0 && offer.price > budgetNumber) return false;
    if (brand && offer.brand !== brand) return false;
    if (model && offer.model !== model) return false;
    if (yearFrom && offer.year < Number(yearFrom)) return false;
    if (country && offer.country !== country) return false;
    if (bodyType && offer.body !== bodyType) return false;

    return true;
  });
}

type SelectOption = {
  value: string;
  label: string;
};

function BodyTypeIcon({ type }: { type: string }) {
  const commonProps = {
    width: 58,
    height: 32,
    viewBox: "0 0 58 32",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": true,
  } as const;

  const wheels = (
    <>
      <circle cx="16" cy="23" r="4" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="43" cy="23" r="4" stroke="currentColor" strokeWidth="2.2" />
    </>
  );

  if (type === "suv") {
    return (
      <svg {...commonProps}>
        <path d="M5 21.5V17L11 10H39L49 16L53 21.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14 10L18 5.5H35L40 10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6 21.5H52" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        {wheels}
      </svg>
    );
  }

  if (type === "offroad") {
    return (
      <svg {...commonProps}>
        <path d="M5 21.5V13.5L10 9H18L21 5.5H42L48 10.5L52 13.5V21.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M21 5.5V13.5M42 5.5V13.5M6 21.5H52" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        {wheels}
      </svg>
    );
  }

  if (type === "sedan") {
    return (
      <svg {...commonProps}>
        <path d="M5 21.5L8 16.5L17 14L23 8.5H37L44 14L51 16L54 21.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 21.5H53" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        {wheels}
      </svg>
    );
  }

  if (type === "wagon") {
    return (
      <svg {...commonProps}>
        <path d="M5 21.5V17L10 12H19L23 7.5H46.5L52 11.5V21.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M23 7.5V14M46.5 7.5V14M7 21.5H52" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        {wheels}
      </svg>
    );
  }

  if (type === "hatchback") {
    return (
      <svg {...commonProps}>
        <path d="M6 21.5V17L12 12H20L24 7.5H38L46 13L49 17V21.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 21.5H49" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        {wheels}
      </svg>
    );
  }

  if (type === "liftback") {
    return (
      <svg {...commonProps}>
        <path d="M5 21.5L8 16.5L17 14L23 8H35L49 15.5L53 21.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M23 8L43 14.5M7 21.5H52" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        {wheels}
      </svg>
    );
  }

  if (type === "coupe") {
    return (
      <svg {...commonProps}>
        <path d="M5 21.5L9 16.5L18 14L25 8.5H36L47 15L52 17V21.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M25 8.5L42 14.5M7 21.5H52" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        {wheels}
      </svg>
    );
  }

  if (type === "convertible") {
    return (
      <svg {...commonProps}>
        <path d="M5 21.5L9 16.5L18 14H29L34 10.5H40L45 15L52 17V21.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M29 14H43M7 21.5H52" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        {wheels}
      </svg>
    );
  }

  if (type === "minivan") {
    return (
      <svg {...commonProps}>
        <path d="M5 21.5V13L10 7H41L50 12.5L53 17V21.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M18 7V14M40 7V14M7 21.5H52" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        {wheels}
      </svg>
    );
  }

  if (type === "pickup") {
    return (
      <svg {...commonProps}>
        <path d="M5 21.5V16L10 14L15 7.5H29L35 14H52V21.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M35 14V18M37 14H52M7 21.5H52" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        {wheels}
      </svg>
    );
  }

  if (type === "van") {
    return (
      <svg {...commonProps}>
        <path d="M5 21.5V8H39L48 12L53 17V21.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M39 8V15H49M7 21.5H52" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        {wheels}
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path d="M6 21.5V17L12 12H20L24 7.5H38L46 13L49 17V21.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 21.5H49" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      {wheels}
    </svg>
  );
}

function SelectField({
  value,
  onChange,
  options,
  searchable = false,
  searchPlaceholder = "Поиск",
  emptyLabel = "Не выбрано",
  bodyIcons = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyLabel?: string;
  bodyIcons?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const placeholder = options.find((option) => option.value === "")?.label ?? "Выберите";
  const selectedOption = options.find((option) => option.value === value);

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");

    return options.filter((option) => {
      if (!option.value) return !normalizedQuery;
      if (!normalizedQuery) return true;
      return option.label.toLocaleLowerCase("ru-RU").includes(normalizedQuery);
    });
  }, [options, query]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }

    if (searchable) {
      window.requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open, searchable]);

  function selectOption(nextValue: string) {
    onChange(nextValue);
    setOpen(false);
    setQuery("");
  }

  return (
    <div
      ref={rootRef}
      className={[
        "relative min-w-0 max-w-full",
        open ? "z-[160]" : "z-0",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={[
          "soft-input flex h-[48px] w-full min-w-0 items-center justify-between gap-3 rounded-[1rem] border bg-white/[0.05] px-3 text-left text-[14px] font-black text-white outline-none transition sm:h-[50px] sm:px-4 sm:text-[15px] md:h-[56px] md:rounded-[1.1rem]",
          open
            ? "rounded-b-none border-red-400/55 bg-[#23252e] shadow-[0_0_0_3px_rgba(239,68,68,0.10)]"
            : "border-white/12 hover:border-white/22 hover:bg-white/[0.07]",
        ].join(" ")}
      >
        <span className={selectedOption?.value ? "min-w-0 truncate text-white" : "min-w-0 truncate text-white/88"}>
          {selectedOption?.label ?? placeholder}
        </span>

        <svg
          width="13"
          height="8"
          viewBox="0 0 14 9"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={["shrink-0 opacity-70 transition", open ? "rotate-180" : ""].join(" ")}
          aria-hidden="true"
        >
          <path
            d="M1 1.5L7 7.5L13 1.5"
            stroke="white"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%-1px)] z-[160] overflow-hidden rounded-b-[1.05rem] border border-t-0 border-red-400/45 bg-[#171922] shadow-[0_24px_80px_rgba(0,0,0,0.72)]">
          {searchable ? (
            <div className="sticky top-0 z-10 border-b border-white/10 bg-[#171922] p-2.5">
              <div className="flex h-10 items-center gap-2 rounded-[0.8rem] border border-white/12 bg-[#22242d] px-3 focus-within:border-red-400/55 focus-within:bg-[#272a34]">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 18 18"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="shrink-0 text-white/42"
                  aria-hidden="true"
                >
                  <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.7" />
                  <path d="M12 12L16 16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>

                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={searchPlaceholder}
                  className="min-w-0 flex-1 bg-transparent text-[14px] font-bold text-white outline-none placeholder:text-white/30"
                />

                {query ? (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white/38 transition hover:bg-white/8 hover:text-white"
                    aria-label="Очистить поиск"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {bodyIcons ? (
            <div
              className="max-h-[min(278px,42dvh)] overflow-y-auto overscroll-contain p-2 sm:max-h-[min(420px,58vh)] sm:p-2.5"
              role="listbox"
            >
              <button
                type="button"
                role="option"
                aria-selected={!value}
                onClick={() => selectOption("")}
                className={[
                  "mb-1.5 flex min-h-9 w-full items-center justify-between rounded-[0.75rem] px-3 py-1.5 text-left text-[13px] font-black transition sm:mb-2 sm:min-h-10 sm:rounded-[0.8rem] sm:py-2 sm:text-[14px]",
                  !value
                    ? "bg-red-500 text-white shadow-[0_8px_24px_rgba(239,68,68,0.18)]"
                    : "text-white/72 hover:bg-white/[0.06] hover:text-white",
                ].join(" ")}
              >
                <span>{emptyLabel}</span>
                {!value ? (
                  <svg width="15" height="12" viewBox="0 0 15 12" fill="none" aria-hidden="true">
                    <path d="M1.5 6.2L5.2 10L13.5 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </button>

              <div className="grid grid-cols-3 gap-x-1 gap-y-1 border-t border-white/8 pt-2 sm:gap-x-2 sm:gap-y-2 sm:pt-3 xl:grid-cols-4">
                {options.filter((option) => option.value).map((option) => {
                  const active = option.value === value;

                  return (
                    <button
                      key={`${option.value}_${option.label}`}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => selectOption(option.value)}
                      className="group flex min-h-[62px] flex-col items-center justify-center gap-1 px-0.5 py-1.5 text-center sm:min-h-[72px] sm:gap-1.5 sm:px-1 sm:py-2"
                    >
                      <span
                        className={[
                          "transition duration-200",
                          active
                            ? "text-[#ff1f2f] drop-shadow-[0_0_14px_rgba(255,31,47,0.55)]"
                            : "text-white group-hover:text-white",
                        ].join(" ")}
                      >
                        <BodyTypeIcon type={option.value} />
                      </span>
                      <span className="max-w-full truncate text-[10px] font-black leading-tight text-white sm:text-[11px]">
                        {option.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="max-h-[264px] overflow-y-auto overscroll-contain p-1.5" role="listbox">
              {filteredOptions.length ? (
                filteredOptions.map((option) => {
                  const active = option.value === value;
                  const optionLabel = option.value ? option.label : emptyLabel;

                  return (
                    <button
                      key={`${option.value}_${option.label}`}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => selectOption(option.value)}
                      className={[
                        "flex min-h-10 w-full items-center justify-between gap-3 rounded-[0.78rem] px-3 py-2 text-left text-[14px] font-bold transition",
                        active
                          ? "bg-red-500 text-white shadow-[0_8px_24px_rgba(239,68,68,0.18)]"
                          : "text-white/76 hover:bg-white/[0.07] hover:text-white",
                      ].join(" ")}
                    >
                      <span className="min-w-0 truncate">{optionLabel}</span>
                      {active ? (
                        <svg width="15" height="12" viewBox="0 0 15 12" fill="none" aria-hidden="true">
                          <path d="M1.5 6.2L5.2 10L13.5 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : null}
                    </button>
                  );
                })
              ) : (
                <div className="px-3 py-6 text-center text-[13px] font-bold text-white/40">
                  Ничего не найдено
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function BudgetField({
  value,
  budgetNumber,
  manualMode,
  pickerOpen,
  onTogglePicker,
  onSelectPreset,
  onManualMode,
  onManualChange,
}: {
  value: string;
  budgetNumber: number;
  manualMode: boolean;
  pickerOpen: boolean;
  onTogglePicker: () => void;
  onSelectPreset: (value: number) => void;
  onManualMode: () => void;
  onManualChange: (value: string) => void;
}) {
  const budgetLabel =
    budgetNumber > 0 ? `до ${formatMoney(budgetNumber)} ₽` : "Выберите бюджет";

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={onTogglePicker}
        className="soft-input flex h-[56px] w-full min-w-0 items-center justify-between gap-3 rounded-[1.1rem] border border-white/12 bg-white/[0.05] px-4 text-left text-white outline-none transition hover:border-white/20 hover:bg-white/[0.07] focus:border-red-400/60 sm:h-[60px] sm:px-5"
      >
        <span className="min-w-0 truncate text-[17px] font-black sm:text-[18px]">
          {budgetLabel}
        </span>

        <svg
          width="14"
          height="9"
          viewBox="0 0 14 9"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={[
            "shrink-0 opacity-70 transition",
            pickerOpen ? "rotate-180" : "",
          ].join(" ")}
          aria-hidden="true"
        >
          <path
            d="M1 1.5L7 7.5L13 1.5"
            stroke="white"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {pickerOpen ? (
        <div className="mt-2 rounded-[1.1rem] border border-white/10 bg-[#18191f]/95 p-2 shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
          <div className="grid gap-2 sm:grid-cols-2">
            {budgetChips.map((chip) => {
              const active = budgetNumber === chip && !manualMode;

              return (
                <button
                  key={chip}
                  type="button"
                  onClick={() => onSelectPreset(chip)}
                  className={[
                    "h-11 rounded-[0.9rem] border px-3 text-sm font-black transition",
                    active
                      ? "border-red-400 bg-red-500 text-white shadow-[0_0_26px_rgba(239,68,68,0.22)]"
                      : "border-white/12 bg-white/[0.04] text-white/78 hover:border-white/22 hover:bg-white/[0.07]",
                  ].join(" ")}
                >
                  до {formatMoney(chip)} ₽
                </button>
              );
            })}

            <button
              type="button"
              onClick={onManualMode}
              className="h-11 rounded-[0.9rem] border border-white/12 bg-white/[0.04] px-3 text-sm font-black text-white/78 transition hover:border-red-300/45 hover:bg-red-500/10 hover:text-white sm:col-span-2"
            >
              Ввести вручную
            </button>
          </div>
        </div>
      ) : null}

      {manualMode ? (
        <div className="mt-2 rounded-[1.1rem] border border-white/10 bg-white/[0.06] px-4 py-3">
          <div className="mb-1 text-[11px] font-black uppercase tracking-[0.14em] text-white/38">
            Ручной бюджет
          </div>

          <div className="flex min-w-0 items-center justify-between gap-3">
            <input
              value={value ? formatMoney(Number(value || 0)) : ""}
              onChange={(event) => onManualChange(event.target.value)}
              inputMode="numeric"
              placeholder="Введите сумму"
              className="min-w-0 flex-1 bg-transparent text-[25px] font-black tracking-[-0.04em] text-white outline-none placeholder:text-white/20 sm:text-[30px]"
            />

            <div className="shrink-0 text-[24px] font-black text-white/48">
              ₽
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BenefitIcon({ type }: { type: BenefitType }) {
  if (type === "globe") {
    return (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
        <path
          d="M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18Z"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M3.6 9h16.8M3.6 15h16.8M12 3c2.2 2.35 3.3 5.35 3.3 9s-1.1 6.65-3.3 9M12 3C9.8 5.35 8.7 8.35 8.7 12s1.1 6.65 3.3 9"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (type === "delivery") {
    return (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
        <path
          d="M3 7h11v10H3V7Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M14 10h4l3 3v4h-7v-7Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M7 20a2 2 0 1 0 0-4a2 2 0 0 0 0 4ZM18 20a2 2 0 1 0 0-4a2 2 0 0 0 0 4Z"
          stroke="currentColor"
          strokeWidth="2"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
      <path
        d="M13 2L4 14h7l-1 8l10-13h-7l0-7Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BenefitCard({
  icon,
  title,
  text,
}: {
  icon: BenefitType;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-2xl bg-white/6 px-4 py-4">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-red-400/25 bg-red-500/10 text-red-400 shadow-[0_0_30px_rgba(239,68,68,0.12)]">
          <BenefitIcon type={icon} />
        </div>
        <div className="text-sm font-black leading-5 text-white">{title}</div>
      </div>

      <div className="mt-3 text-sm font-medium leading-6 text-white/55">
        {text}
      </div>
    </div>
  );
}

function TopAvtoExecutorBlock() {
  const [logoFailed, setLogoFailed] = useState(false);

  return (
    <div className="mt-4 grid gap-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 md:grid-cols-[1fr_290px] md:px-5 md:py-5">
      <div>
        <h2 className="text-base font-black text-white md:text-lg">
          АвтоЦена — подбор автомобиля под ваш бюджет
        </h2>

        <p className="mt-2 max-w-4xl text-sm font-medium leading-7 text-white/58 md:text-[15px]">
          Сервис помогает быстро понять, какой автомобиль можно привезти из Японии, Китая, Кореи, ОАЭ или Европы. На первом этапе вы
          указываете только базовые параметры — бюджет, марку, модель, год и
          страну. Дальше система показывает предварительную АвтоЦену и реальные
          варианты для следующего шага с менеджером TopAvto.
        </p>
      </div>

      <div className="flex items-center justify-center rounded-[1.3rem] border border-white/10 bg-black/20 px-5 py-5">
        {!logoFailed ? (
          <img
            src="/brands/topavto-logo.png"
            alt="TopAvto"
            className="max-h-[82px] w-full object-contain"
            onError={() => setLogoFailed(true)}
          />
        ) : (
          <div className="text-center">
            <div className="text-3xl font-black tracking-[-0.05em] text-white">
              TopAvto
            </div>
            <div className="mt-1 text-xs font-black uppercase tracking-[0.18em] text-white/42">
              исполнитель сделки
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


function OfferEstimateDetails({ offer }: { offer: CatalogOffer }) {
  const carCost = Math.round((offer.price * 0.58) / 10000) * 10000;
  const logistics = Math.round((offer.price * 0.09) / 10000) * 10000;
  const customs = Math.round((offer.price * 0.22) / 10000) * 10000;
  const broker = Math.round((offer.price * 0.05) / 10000) * 10000;
  const commission = Math.max(
    90000,
    Math.round((offer.price * 0.035) / 10000) * 10000,
  );

  const lines = [
    ["Стоимость авто", carCost],
    ["Логистика", logistics],
    ["Таможня и утиль", customs],
    ["Брокер и оформление", broker],
    ["Комиссия TopAvto", commission],
  ] as const;

  return (
    <div className="grid max-w-xl gap-2.5 text-[13px] font-bold leading-6 text-white/70 sm:text-sm">
      {lines.map(([label, amount]) => (
        <div
          key={label}
          className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-2 gap-y-1 md:flex md:gap-2"
        >
          <span className="shrink-0 text-red-300/80">·</span>
          <span className="min-w-0 text-white/76 md:shrink-0">{label}</span>
          <span className="mb-[4px] hidden min-w-[20px] flex-1 border-b border-dotted border-white/22 md:block" />
          <span className="min-w-[104px] shrink-0 text-right font-black text-white sm:min-w-[118px] md:min-w-[132px]">
            {formatMoney(amount)} ₽
          </span>
        </div>
      ))}
    </div>
  );
}

function CarPhotoPlaceholder({ className = "h-full w-full" }: { className?: string }) {
  return (
    <div
      className={[
        "relative overflow-hidden bg-[radial-gradient(circle_at_25%_18%,rgba(239,68,68,0.42),transparent_36%),radial-gradient(circle_at_78%_8%,rgba(255,255,255,0.12),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.14),rgba(255,255,255,0.025))]",
        className,
      ].join(" ")}
    >
      <div className="absolute inset-0 flex items-center justify-center opacity-[0.13]">
        <BrandMark className="h-32 w-32 sm:h-40 sm:w-40" />
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-[#10121a]/92 via-[#10121a]/18 to-transparent" />
    </div>
  );
}

function ReadyCatalogCard({
  offer,
  onOpen,
}: {
  offer: CatalogOffer;
  onOpen: (offer: CatalogOffer) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(offer)}
      className="group min-w-0 overflow-hidden rounded-[1.25rem] border border-white/10 bg-white/[0.045] text-left shadow-[0_20px_70px_rgba(0,0,0,0.18)] transition hover:-translate-y-1 hover:border-red-300/30 hover:bg-white/[0.065] active:scale-[0.99]"
    >
      <div className="relative h-[190px] overflow-hidden sm:h-[205px] xl:h-[180px] 2xl:h-[205px]">
        <CarPhotoPlaceholder />

        <div className="absolute left-3 top-3 rounded-full border border-white/20 bg-black/34 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-white/86 backdrop-blur">
          {offer.countryLabel}
        </div>

        <div className="absolute right-3 top-3 rounded-full border border-red-300/25 bg-red-500/18 px-3 py-1 text-[11px] font-black text-red-100 backdrop-blur">
          {offer.bodyLabel}
        </div>

        <div className="absolute bottom-3 left-3 rounded-full border border-white/12 bg-black/34 px-3 py-1 text-[11px] font-black text-white/82 backdrop-blur">
          {offer.year}
        </div>

        <div className="absolute bottom-3 right-3 rounded-full border border-white/12 bg-black/34 px-3 py-1 text-[11px] font-black text-white/82 backdrop-blur">
          {offer.mileage}
        </div>

        <div className="absolute bottom-11 left-3 right-3">
          <div className="line-clamp-2 text-[18px] font-black leading-[1.15] tracking-[-0.035em] text-white drop-shadow-[0_2px_18px_rgba(0,0,0,0.55)]">
            {offer.title}
          </div>
        </div>
      </div>

      <div className="px-4 pb-4 pt-3">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-white/34">
              ориентир
            </div>
            <div className="mt-1 text-[20px] font-black tracking-[-0.045em] text-white">
              {formatMoney(offer.price)} ₽
            </div>
          </div>

          <div className="shrink-0 rounded-full border border-white/10 bg-white/[0.055] px-3 py-1.5 text-xs font-black text-white/72 transition group-hover:border-red-300/35 group-hover:text-white">
            Подробнее
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-white/58">
          <span className="rounded-full bg-white/[0.05] px-3 py-1.5">
            {offer.engine}
          </span>
          <span className="rounded-full bg-white/[0.05] px-3 py-1.5">
            {offer.power}
          </span>
        </div>
      </div>
    </button>
  );
}

function ReadyCatalogGrid({
  offers,
  onOpen,
}: {
  offers: CatalogOffer[];
  onOpen: (offer: CatalogOffer) => void;
}) {
  const visibleOffers = offers.length > 0 ? offers : readyCatalog;

  return (
    <section className="w-full min-w-0">
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visibleOffers.map((offer) => (
          <ReadyCatalogCard key={offer.id} offer={offer} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

function OfferBottomSheet({
  offer,
  onClose,
  onOpenResults,
}: {
  offer: CatalogOffer | null;
  onClose: () => void;
  onOpenResults: (offer: CatalogOffer) => void;
}) {
  useEffect(() => {
    if (!offer) return;

    const previousOverflow = document.body.style.overflow;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [offer, onClose]);

  if (!offer || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="ac-viewport-modal fixed inset-0 z-[9998] flex items-end justify-center bg-[#03050a] md:items-center md:bg-black/80 md:p-5 md:backdrop-blur-[10px]"
      role="dialog"
      aria-modal="true"
      aria-label={offer.title}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 hidden md:block"
        aria-label="Закрыть карточку"
      />

      <div className="relative z-10 flex h-full max-h-[100dvh] w-full flex-col overflow-hidden bg-[#0b0d14] md:h-auto md:max-h-[calc(100dvh-40px)] md:max-w-5xl md:rounded-[2rem] md:shadow-[0_30px_120px_rgba(0,0,0,0.72)]">
        <div className="ac-safe-scroll min-h-0 flex-1 overflow-y-auto">
          <div className="relative h-[270px] overflow-hidden sm:h-[340px]">
            <CarPhotoPlaceholder />

            <div className="absolute left-4 top-4 flex max-w-[calc(100%-76px)] flex-wrap gap-2 sm:left-6 sm:top-6">
              <span className="rounded-full bg-red-500 px-3 py-1 text-xs font-black text-white">
                {offer.countryLabel}
              </span>
              <span className="rounded-full bg-black/35 px-3 py-1 text-xs font-black text-white/78 backdrop-blur">
                {offer.bodyLabel}
              </span>
              <span className="rounded-full bg-black/35 px-3 py-1 text-xs font-black text-white/78 backdrop-blur">
                {offer.year}
              </span>
              <span className="rounded-full bg-black/35 px-3 py-1 text-xs font-black text-white/78 backdrop-blur">
                {offer.mileage}
              </span>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="absolute right-4 top-4 z-20 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/55 text-white/86 shadow-[0_8px_30px_rgba(0,0,0,0.45)] backdrop-blur transition hover:bg-black/75 hover:text-white sm:right-6 sm:top-6"
              aria-label="Закрыть"
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 18 18"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M3 3L15 15M15 3L3 15"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
              </svg>
            </button>

            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-[#0b0d14] via-[#0b0d14]/82 to-transparent px-4 pb-5 pt-20 sm:px-6 sm:pb-6">
              <h2 className="max-w-3xl text-[30px] font-black leading-none tracking-[-0.045em] text-white sm:text-[48px]">
                {offer.title}
              </h2>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm font-bold text-white/64">
                <span>{offer.engine}</span>
                <span>·</span>
                <span>{offer.power}</span>
              </div>
            </div>
          </div>

          <div className="grid gap-5 p-4 pb-6 sm:p-6 md:grid-cols-[minmax(0,1fr)_310px] md:p-7">
            <div className="min-w-0">
              <p className="max-w-3xl text-sm font-medium leading-7 text-white/58 sm:text-base">
                Готовый пример варианта под ваш бюджет. Финальная цена зависит от
                курса, состояния автомобиля, даты покупки, логистики и города доставки.
              </p>

              <div className="mt-5">
                <OfferEstimateDetails offer={offer} />
              </div>
            </div>

            <div className="md:border-l md:border-white/10 md:pl-6">
              <div className="text-[12px] font-black uppercase tracking-[0.18em] text-white/42">
                ориентир цены
              </div>
              <div className="mt-3 text-[32px] font-black tracking-[-0.055em] text-white sm:text-[38px]">
                {formatMoney(offer.price)} ₽
              </div>
              <div className="mt-1 text-sm font-black text-emerald-300">
                по готовому варианту
              </div>

              <div className="mt-5 grid gap-2 text-sm font-bold text-white/72">
                <div className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                  Согласование бюджета
                </div>
                <div className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                  Проверка и покупка автомобиля
                </div>
                <div className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                  Доставка, таможня и оформление
                </div>
              </div>

              <button
                type="button"
                onClick={() => onOpenResults(offer)}
                className="mt-6 flex h-14 w-full items-center justify-center rounded-[1.05rem] bg-red-600 px-4 text-base font-black text-white transition hover:bg-red-500 active:scale-[0.995]"
              >
                Получить предложение
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function BenefitIconButton({
  benefit,
  active,
  onClick,
}: {
  benefit: (typeof landingBenefits)[number];
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border transition",
        active
          ? "border-red-300/50 bg-red-500 text-white shadow-[0_0_34px_rgba(239,68,68,0.26)]"
          : "border-red-400/25 bg-red-500/10 text-red-400 hover:border-red-300/40 hover:bg-red-500/18 hover:text-red-100",
      ].join(" ")}
      aria-label={benefit.title}
    >
      <BenefitIcon type={benefit.icon} />
    </button>
  );
}

function BuyerPhotoTile({
  photo,
  index,
  onOpen,
}: {
  photo: (typeof buyerPhotos)[number];
  index: number;
  onOpen: (index: number) => void;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <button
      type="button"
      onClick={() => onOpen(index)}
      className="group relative h-[150px] w-[220px] shrink-0 overflow-hidden rounded-[1.35rem] border border-white/10 bg-white/[0.035] text-left shadow-[0_18px_60px_rgba(0,0,0,0.18)] transition hover:-translate-y-1 hover:border-red-300/35 sm:h-[180px] sm:w-[270px] lg:h-[205px] lg:w-[315px]"
      aria-label={`Открыть фото ${index + 1} из ${buyerPhotos.length}`}
    >
      {!failed ? (
        <img
          src={photo.src}
          alt={photo.alt}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_22%_18%,rgba(239,68,68,0.32),transparent_36%),linear-gradient(135deg,rgba(255,255,255,0.14),rgba(255,255,255,0.025))]">
          <BrandMark className="h-20 w-20 opacity-30" />
        </div>
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/28 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />
    </button>
  );
}

function BuyerGallery() {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const touchStartX = useRef<number | null>(null);
  const touchDeltaX = useRef(0);
  const selectedPhoto = selectedIndex === null ? null : buyerPhotos[selectedIndex];
  const marqueePhotos = [...buyerPhotos, ...buyerPhotos];

  function showPreviousPhoto() {
    setSelectedIndex((current) => {
      if (current === null) return 0;
      return current === 0 ? buyerPhotos.length - 1 : current - 1;
    });
  }

  function showNextPhoto() {
    setSelectedIndex((current) => {
      if (current === null) return 0;
      return (current + 1) % buyerPhotos.length;
    });
  }

  useEffect(() => {
    if (selectedIndex === null) return;

    const previousOverflow = document.body.style.overflow;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedIndex(null);
      }

      if (event.key === "ArrowLeft") {
        showPreviousPhoto();
      }

      if (event.key === "ArrowRight") {
        showNextPhoto();
      }
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedIndex]);

  useEffect(() => {
    if (selectedIndex === null) return;

    const previousIndex = selectedIndex === 0 ? buyerPhotos.length - 1 : selectedIndex - 1;
    const nextIndex = (selectedIndex + 1) % buyerPhotos.length;

    [previousIndex, nextIndex].forEach((index) => {
      const image = new Image();
      image.src = buyerPhotos[index].src;
    });
  }, [selectedIndex]);

  const photoModal =
    selectedPhoto && selectedIndex !== null && typeof document !== "undefined"
      ? createPortal(
          <div
            className="ac-viewport-modal fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-[#03050a]"
            role="dialog"
            aria-modal="true"
            aria-label={`Фотография ${selectedIndex + 1} из ${buyerPhotos.length}`}
            onClick={() => setSelectedIndex(null)}
            onTouchStart={(event) => {
              touchStartX.current = event.touches[0]?.clientX ?? null;
              touchDeltaX.current = 0;
            }}
            onTouchMove={(event) => {
              if (touchStartX.current === null) return;
              touchDeltaX.current = event.touches[0].clientX - touchStartX.current;
            }}
            onTouchEnd={() => {
              if (Math.abs(touchDeltaX.current) > 48) {
                if (touchDeltaX.current > 0) showPreviousPhoto();
                else showNextPhoto();
              }
              touchStartX.current = null;
              touchDeltaX.current = 0;
            }}
          >
            <div className="absolute inset-0 flex items-center justify-center px-0 pb-[calc(66px+env(safe-area-inset-bottom,0px))] pt-[calc(60px+env(safe-area-inset-top,0px))] sm:px-20 sm:pb-20 sm:pt-16">
              <img
                key={selectedPhoto.src}
                src={selectedPhoto.src}
                alt={selectedPhoto.alt}
                draggable={false}
                onClick={(event) => event.stopPropagation()}
                className="block max-h-full max-w-full select-none object-contain sm:rounded-[1.4rem] sm:shadow-[0_30px_120px_rgba(0,0,0,0.72)]"
              />
            </div>

            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                showPreviousPhoto();
              }}
              className="fixed left-2 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white shadow-[0_10px_34px_rgba(0,0,0,0.42)] backdrop-blur-md transition hover:bg-red-500 sm:left-5 sm:h-14 sm:w-14"
              aria-label="Предыдущее фото"
            >
              <svg width="18" height="30" viewBox="0 0 18 30" fill="none" aria-hidden="true">
                <path d="M16 2L3 15L16 28" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                showNextPhoto();
              }}
              className="fixed right-2 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white shadow-[0_10px_34px_rgba(0,0,0,0.42)] backdrop-blur-md transition hover:bg-red-500 sm:right-5 sm:h-14 sm:w-14"
              aria-label="Следующее фото"
            >
              <svg width="18" height="30" viewBox="0 0 18 30" fill="none" aria-hidden="true">
                <path d="M2 2L15 15L2 28" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setSelectedIndex(null);
              }}
              className="ac-safe-close fixed right-3 z-30 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white shadow-[0_8px_30px_rgba(0,0,0,0.45)] backdrop-blur-md transition hover:bg-red-500 sm:right-6"
              aria-label="Закрыть фото"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M3 3L15 15M15 3L3 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </button>

            <div
              className="fixed bottom-[calc(14px+env(safe-area-inset-bottom,0px))] left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-black/60 px-4 py-2 text-[13px] font-black text-white/82 shadow-[0_10px_34px_rgba(0,0,0,0.42)] backdrop-blur-md"
              onClick={(event) => event.stopPropagation()}
            >
              <span className="text-white">{selectedIndex + 1}</span>
              <span className="text-white/28">/</span>
              <span>{buyerPhotos.length}</span>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <section className="mt-7 overflow-hidden md:mt-8">
      <h2 className="max-w-3xl text-[26px] font-black leading-none tracking-[-0.04em] text-white md:text-[38px]">
        Те, кто узнали — уже ездят!
      </h2>

      <div className="buyer-gallery-mask mt-5 overflow-hidden">
        <div className="buyer-gallery-track flex w-max gap-3 sm:gap-4">
          {marqueePhotos.map((photo, index) => (
            <BuyerPhotoTile
              key={`${photo.src}-${index}`}
              photo={photo}
              index={index % buyerPhotos.length}
              onOpen={setSelectedIndex}
            />
          ))}
        </div>
      </div>

      {photoModal}

      <style>{`
        .buyer-gallery-mask {
          -webkit-mask-image: linear-gradient(
            90deg,
            transparent,
            #000 7%,
            #000 93%,
            transparent
          );
          mask-image: linear-gradient(
            90deg,
            transparent,
            #000 7%,
            #000 93%,
            transparent
          );
        }

        .buyer-gallery-track {
          animation: buyer-gallery-marquee 84s linear infinite;
        }

        .buyer-gallery-track:hover {
          animation-play-state: paused;
        }

        @keyframes buyer-gallery-marquee {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(-50%);
          }
        }

        @media (max-width: 767px) {
          .buyer-gallery-track {
            animation-duration: 68s;
          }
        }
      `}</style>
    </section>
  );
}

function BenefitListRow({
  benefit,
}: {
  benefit: (typeof landingBenefits)[number];
}) {
  return (
    <div className="grid grid-cols-[44px_minmax(0,1fr)] items-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[rgba(255,75,67,0.34)] bg-[rgba(255,75,67,0.07)] text-[#ff4b43] shadow-[0_0_24px_rgba(239,68,68,0.10)]">
        <BenefitIcon type={benefit.icon} />
      </div>

      <div className="min-w-0 pt-0.5">
        <div className="text-[15px] font-black leading-5 text-white">
          {benefit.title}
        </div>
        <p className="mt-1 max-w-[720px] text-[13px] font-medium leading-6 text-[rgba(255,255,255,0.58)]">
          {benefit.text}
        </p>
      </div>
    </div>
  );
}

function LandingInfoBlocks({ className = "" }: { className?: string }) {
  const [activeBenefitIndex, setActiveBenefitIndex] = useState(0);
  const activeBenefit = landingBenefits[activeBenefitIndex];

  function showPrevBenefit() {
    setActiveBenefitIndex((current) =>
      current === 0 ? landingBenefits.length - 1 : current - 1,
    );
  }

  function showNextBenefit() {
    setActiveBenefitIndex((current) => (current + 1) % landingBenefits.length);
  }

  return (
    <section className={["w-full min-w-0", className].join(" ")}>
      <div className="hidden gap-4 lg:grid">
        {landingBenefits.map((benefit) => (
          <BenefitListRow key={benefit.id} benefit={benefit} />
        ))}
      </div>

      <div className="lg:hidden">
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={showPrevBenefit}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/45 transition hover:bg-white/[0.08] hover:text-white/75"
            aria-label="Предыдущее преимущество"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M10 3L5 8L10 13"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <div className="flex items-center justify-center gap-3">
            {landingBenefits.map((benefit, index) => (
              <BenefitIconButton
                key={benefit.id}
                benefit={benefit}
                active={index === activeBenefitIndex}
                onClick={() => setActiveBenefitIndex(index)}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={showNextBenefit}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/45 transition hover:bg-white/[0.08] hover:text-white/75"
            aria-label="Следующее преимущество"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M6 3L11 8L6 13"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        <div className="mt-4 text-center">
          <h2 className="text-[24px] font-black leading-[1.05] tracking-[-0.04em] text-white">
            {activeBenefit.title}
          </h2>
          <p className="mx-auto mt-3 max-w-[310px] text-[15px] font-medium leading-7 text-white/58">
            {activeBenefit.text}
          </p>
        </div>
      </div>
    </section>
  );
}

export default function HomePage() {
  const router = useRouter();

  const [budget, setBudget] = useState("3000000");
  const [budgetPickerOpen, setBudgetPickerOpen] = useState(false);
  const [manualBudgetMode, setManualBudgetMode] = useState(false);
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [yearFrom, setYearFrom] = useState("2020");
  const [country, setCountry] = useState("");
  const [bodyType, setBodyType] = useState("");
  const [selectedOffer, setSelectedOffer] = useState<CatalogOffer | null>(null);

  const availableModelOptions = useMemo(
    () =>
      modelOptions.filter(
        (option) => !option.value || !brand || option.brand === brand,
      ),
    [brand],
  );

  const budgetNumber = useMemo(() => {
    const digits = budget.replace(/\D/g, "");
    return digits ? Number(digits) : 0;
  }, [budget]);

  const filteredCatalogOffers = useMemo(
    () =>
      getFilteredCatalogOffers({
        budgetNumber,
        brand,
        model,
        yearFrom,
        country,
        bodyType,
      }),
    [budgetNumber, brand, model, yearFrom, country, bodyType],
  );

  const foundLabel = `Нашли ${filteredCatalogOffers.length} ${pluralVariant(filteredCatalogOffers.length)}`;

  function handleBudgetChange(value: string) {
    const digits = value.replace(/\D/g, "");
    setBudget(digits);
  }

  function selectBudgetPreset(value: number) {
    setBudget(String(value));
    setManualBudgetMode(false);
    setBudgetPickerOpen(false);
  }

  function openManualBudget() {
    setManualBudgetMode(true);
    setBudgetPickerOpen(false);
  }

  function handleBrandChange(nextBrand: string) {
    setBrand(nextBrand);

    if (
      model &&
      !modelOptions.some(
        (option) => option.value === model && (!nextBrand || option.brand === nextBrand),
      )
    ) {
      setModel("");
    }
  }

  function buildResultsUrl(
    extra?: Partial<{
      budget: number;
      brand: string;
      model: string;
      year: number | string;
      country: string;
      body: string;
    }>,
  ) {
    const params = new URLSearchParams();

    const finalBudget = extra?.budget ?? budgetNumber;
    const finalBrand = extra?.brand ?? brand;
    const finalModel = extra?.model ?? model;
    const finalYear = extra?.year ?? yearFrom;
    const finalCountry = extra?.country ?? country;
    const finalBody = extra?.body ?? bodyType;

    if (finalBudget > 0) params.set("budget", String(finalBudget));
    if (finalBrand) params.set("brand", finalBrand);
    if (finalModel) params.set("model", finalModel);
    if (finalYear) params.set("yearFrom", String(finalYear));
    if (finalCountry) params.set("market", finalCountry);
    if (finalBody) params.set("body", finalBody);

    return `/results?${params.toString()}`;
  }

  function submitForm() {
    router.push(buildResultsUrl());
  }

  function openOfferResults(offer: CatalogOffer) {
    router.push(
      buildResultsUrl({
        budget: offer.price,
        brand: offer.brand,
        model: offer.model,
        year: offer.year,
        country: offer.country,
        body: offer.body,
      }),
    );
  }

  const calculator = (
    <div
      id="form"
      className="glass relative mx-auto box-border w-full max-w-[318px] overflow-visible rounded-[1.35rem] border border-white/12 bg-white/[0.06] p-3 shadow-[0_20px_80px_rgba(255,0,76,0.12)] sm:max-w-[420px] sm:rounded-[1.7rem] sm:p-4 xl:max-w-none xl:rounded-[2rem] xl:p-6"
    >
      <div className="mb-3 flex items-center justify-between gap-3 xl:mb-4">
        <div className="text-[13px] font-bold uppercase tracking-[0.14em] text-red-200/90">
          Бюджет
        </div>

        <div className="shrink-0 rounded-full border border-white/14 bg-white/8 px-3 py-1.5 text-[11px] font-black text-white/70 sm:text-xs">
          {foundLabel}
        </div>
      </div>

      <BudgetField
        value={budget}
        budgetNumber={budgetNumber}
        manualMode={manualBudgetMode}
        pickerOpen={budgetPickerOpen}
        onTogglePicker={() => setBudgetPickerOpen((current) => !current)}
        onSelectPreset={selectBudgetPreset}
        onManualMode={openManualBudget}
        onManualChange={handleBudgetChange}
      />

      <div className="mt-3 grid min-w-0 grid-cols-2 gap-2 sm:gap-3 xl:mt-4">
        <SelectField
          value={brand}
          onChange={handleBrandChange}
          options={brandOptions}
          searchable
          searchPlaceholder="Найти марку"
          emptyLabel="Любая марка"
        />
        <SelectField
          value={model}
          onChange={setModel}
          options={availableModelOptions}
          searchable
          searchPlaceholder="Найти модель"
          emptyLabel="Любая модель"
        />
        <SelectField
          value={yearFrom}
          onChange={setYearFrom}
          options={yearOptions}
          emptyLabel="Любой год"
        />
        <SelectField
          value={country}
          onChange={setCountry}
          options={countryOptions}
          emptyLabel="Любая страна"
        />

        <div className="col-span-2 min-w-0">
          <SelectField
            value={bodyType}
            onChange={setBodyType}
            options={bodyOptions}
            emptyLabel="Любой кузов"
            bodyIcons
          />
        </div>
      </div>

      <button
        onClick={submitForm}
        className="mt-4 flex h-[58px] w-full items-center justify-center gap-3 rounded-[1.05rem] bg-red-600 px-3 text-[16px] font-black text-white transition hover:bg-red-500 active:scale-[0.995] sm:text-[17px] xl:mt-5 xl:h-[62px] xl:rounded-[1.15rem] xl:text-[18px]"
      >
        <span className="relative flex h-3 w-3 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-white" />
        </span>
        <span className="whitespace-nowrap">Узнать АвтоЦену</span>
      </button>
    </div>
  );

  return (
    <main className="min-h-screen w-full max-w-[100vw] overflow-x-hidden px-3 py-4 pb-14 md:px-8 md:py-6">
      <input
        id="ac-drawer-toggle"
        className="ac-drawer-input"
        type="checkbox"
        aria-hidden="true"
      />
      <div className="mx-auto w-full max-w-[1500px] overflow-x-hidden">
        <header className="sticky top-0 z-50 -mx-3 flex items-center justify-between gap-4 bg-[#070a12]/82 px-3 py-2 backdrop-blur-xl md:-mx-8 md:px-8 xl:-mx-0 xl:bg-transparent xl:px-0">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <BrandMark className="h-9 w-9 shrink-0 md:h-10 md:w-10" />

            <div className="min-w-0">
              <div className="text-[18px] font-black leading-none md:text-[22px]">
                <span className="text-red-500">Авто</span>
                <span className="text-white">Цена</span>
              </div>
              <div className="text-[12px] font-bold leading-none text-white/45">
                подбор · расчёт
              </div>
            </div>
          </Link>

          <nav className="hidden items-center gap-2 text-sm font-bold text-white/72 md:flex">
            <a
              href="/partner/landing"
              className="rounded-full bg-white/8 px-4 py-2 transition hover:bg-white/12"
            >
              Партнёрам
            </a>
            <a
              href="/login"
              className="rounded-full bg-white/8 px-4 py-2 transition hover:bg-white/12"
            >
              Вход
            </a>
          </nav>

          <label
            htmlFor="ac-drawer-toggle"
            className="ac-drawer-burger md:hidden"
            aria-label="Открыть меню"
          >
            <svg
              width="19"
              height="14"
              viewBox="0 0 19 14"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M1 1H18M1 7H18M1 13H18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </label>
        </header>

        <section className="relative w-full min-w-0 pt-5 lg:pt-8">
          <div className="lg:sticky lg:top-[64px] lg:z-40 lg:-mx-2 lg:px-2 lg:pb-6 xl:top-6 xl:-mx-0 xl:px-0">
            <div className="grid w-full min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-8 xl:grid-cols-[minmax(0,1fr)_430px] xl:gap-10 2xl:grid-cols-[minmax(0,1fr)_470px]">
              <div className="relative z-10 w-full min-w-0">
                <h1 className="text-[24px] font-black leading-[0.98] tracking-[-0.035em] text-white sm:text-[40px] md:text-[56px] lg:text-[72px] xl:text-[86px] 2xl:text-[92px]">
                  <span className="block">Цена на авто под заказ</span>
                </h1>

                <p className="mt-3 text-[15px] font-medium leading-7 text-white/72 md:mt-5 md:text-[18px] md:leading-8 lg:text-[19px] xl:text-[20px]">
                  Укажите бюджет. Сервис покажет, что можно привезти под ключ.
                </p>

                <LandingInfoBlocks className="mt-6 hidden lg:block" />

                <div className="mt-5 lg:hidden">{calculator}</div>
                <LandingInfoBlocks className="mt-7 lg:hidden" />
              </div>

              <aside className="hidden lg:block lg:self-start">
                {calculator}
              </aside>
            </div>

            <div className="mt-6 h-px w-full bg-white/10 lg:mt-8" />
          </div>

          <div className="relative z-10 mt-7 lg:mt-8">
            <BuyerGallery />
            <TopAvtoExecutorBlock />

            <div className="relative mt-4 md:mt-5">
              <div className="pointer-events-none sticky top-[64px] z-30 hidden h-6 lg:block xl:top-6">
                <div className="h-px w-full bg-gradient-to-r from-red-500 via-white/18 to-transparent" />
              </div>
              <ReadyCatalogGrid
                offers={filteredCatalogOffers}
                onOpen={setSelectedOffer}
              />
            </div>
          </div>
        </section>      </div>

      <OfferBottomSheet
        offer={selectedOffer}
        onClose={() => setSelectedOffer(null)}
        onOpenResults={openOfferResults}
      />

      <label
        htmlFor="ac-drawer-toggle"
        className="ac-drawer-backdrop md:hidden"
        aria-label="Закрыть меню"
      />

      <aside className="ac-drawer-panel md:hidden" aria-label="Мобильное меню">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <BrandMark className="h-9 w-9 shrink-0" />

            <div>
              <div className="text-lg font-black leading-none">
                <span className="text-red-500">Авто</span>
                <span className="text-white">Цена</span>
              </div>
              <div className="mt-1 text-xs font-bold text-white/42">меню</div>
            </div>
          </div>

          <label
            htmlFor="ac-drawer-toggle"
            className="ac-drawer-close"
            aria-label="Закрыть меню"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M2 2L14 14M14 2L2 14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </label>
        </div>

        <nav className="mt-8 grid gap-3">
          <Link href="/partner/landing" className="ac-drawer-link">
            <span>Партнёрам</span>
            <span className="ac-drawer-icon" aria-hidden="true">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M7.5 12.2L10.2 9.5C11 8.7 12.2 8.7 13 9.5L14.5 11C15.2 11.7 16.3 11.7 17 11L18.2 9.8"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M3.5 12.5L7.3 16.3C8.1 17.1 9.4 17.1 10.2 16.3L11 15.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M20.5 12.5L16.7 16.3C15.9 17.1 14.6 17.1 13.8 16.3L9.8 12.3"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M3 9.5L6.5 6H9.5M21 9.5L17.5 6H14.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </Link>

          <Link href="/login" className="ac-drawer-link ac-drawer-link--red">
            <span>Вход</span>
            <span
              className="ac-drawer-icon ac-drawer-icon--red"
              aria-hidden="true"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M3 9H14M10 5L14 9L10 13"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </Link>
        </nav>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm font-medium leading-6 text-white/55">
          Для менеджеров и партнёров. CRM и API доступны только после входа.
        </div>
      </aside>
    </main>
  );
}