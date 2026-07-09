"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const budgetChips = [1500000, 2000000, 2500000, 3000000, 4000000, 5000000];

const brandOptions = [
  { value: "", label: "Марка" },
  { value: "Toyota", label: "Toyota" },
  { value: "Honda", label: "Honda" },
  { value: "BMW", label: "BMW" },
  { value: "Audi", label: "Audi" },
  { value: "Kia", label: "Kia" },
  { value: "Hyundai", label: "Hyundai" },
  { value: "Lexus", label: "Lexus" }
];

const modelOptions = [
  { value: "", label: "Модель" },
  { value: "Harrier", label: "Harrier" },
  { value: "Vezel", label: "Vezel" },
  { value: "Camry", label: "Camry" },
  { value: "A3 Sportback", label: "A3 Sportback" },
  { value: "K5", label: "K5" },
  { value: "320", label: "320" }
];

const yearOptions = [
  { value: "", label: "Год от" },
  { value: "2018", label: "2018" },
  { value: "2019", label: "2019" },
  { value: "2020", label: "2020" },
  { value: "2021", label: "2021" },
  { value: "2022", label: "2022" },
  { value: "2023", label: "2023" },
  { value: "2024", label: "2024" }
];

const countryOptions = [
  { value: "", label: "Страна" },
  { value: "japan", label: "Япония" },
  { value: "china", label: "Китай" },
  { value: "korea", label: "Корея" },
  { value: "uae", label: "ОАЭ" },
  { value: "europe", label: "Европа" }
];

const bodyOptions = [
  { value: "", label: "Тип авто" },
  { value: "suv", label: "Кроссовер" },
  { value: "sedan", label: "Седан" },
  { value: "wagon", label: "Универсал" },
  { value: "hatchback", label: "Хэтчбек" }
];

function formatMoney(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function SelectField({
  value,
  onChange,
  options
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative min-w-0 max-w-full overflow-hidden">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{ minWidth: 0, maxWidth: "100%" }}
        className="soft-input !h-[48px] !w-full !min-w-0 !max-w-full appearance-none truncate rounded-[1rem] border border-white/12 bg-white/[0.05] px-3 pr-9 text-[14px] font-black text-white outline-none transition hover:border-white/20 focus:border-red-400/60 sm:!h-[50px] sm:px-4 sm:pr-10 sm:text-[15px] md:!h-[56px] md:rounded-[1.1rem]"
      >
        {options.map((option) => (
          <option
            key={`${option.value}_${option.label}`}
            value={option.value}
            className="bg-[#12070b] text-white"
          >
            {option.label}
          </option>
        ))}
      </select>

      <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center sm:right-4">
        <svg
          width="13"
          height="8"
          viewBox="0 0 14 9"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="opacity-70"
        >
          <path
            d="M1 1.5L7 7.5L13 1.5"
            stroke="white"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

function BenefitIcon({ type }: { type: "fast" | "globe" | "delivery" }) {
  if (type === "globe") {
    return (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
        <path d="M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18Z" stroke="currentColor" strokeWidth="2" />
        <path d="M3.6 9h16.8M3.6 15h16.8M12 3c2.2 2.35 3.3 5.35 3.3 9s-1.1 6.65-3.3 9M12 3C9.8 5.35 8.7 8.35 8.7 12s1.1 6.65 3.3 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }

  if (type === "delivery") {
    return (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
        <path d="M3 7h11v10H3V7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M14 10h4l3 3v4h-7v-7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M7 20a2 2 0 1 0 0-4a2 2 0 0 0 0 4ZM18 20a2 2 0 1 0 0-4a2 2 0 0 0 0 4Z" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
      <path d="M13 2L4 14h7l-1 8l10-13h-7l0-7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function BenefitCard({
  icon,
  title,
  text
}: {
  icon: "fast" | "globe" | "delivery";
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

      <div className="mt-3 text-sm font-medium leading-6 text-white/55">{text}</div>
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
          Сервис помогает быстро понять, какой автомобиль можно привезти под
          ключ из Японии, Китая, Кореи, ОАЭ или Европы. На первом этапе вы
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

export default function HomePage() {
  const router = useRouter();

  const [budget, setBudget] = useState("3000000");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [yearFrom, setYearFrom] = useState("2020");
  const [country, setCountry] = useState("");
  const [bodyType, setBodyType] = useState("");

  const budgetNumber = useMemo(() => {
    const digits = budget.replace(/\D/g, "");
    return digits ? Number(digits) : 0;
  }, [budget]);

  function handleBudgetChange(value: string) {
    const digits = value.replace(/\D/g, "");
    setBudget(digits);
  }

  function applyBudget(value: number) {
    setBudget(String(value));
  }

  function submitForm() {
    const params = new URLSearchParams();

    if (budgetNumber > 0) params.set("budget", String(budgetNumber));
    if (brand) params.set("brand", brand);
    if (model) params.set("model", model);
    if (yearFrom) params.set("year", yearFrom);
    if (country) params.set("country", country);
    if (bodyType) params.set("body", bodyType);

    router.push(`/results?${params.toString()}`);
  }

  return (
    <main className="min-h-screen w-full max-w-[100vw] overflow-x-hidden px-3 py-4 pb-14 md:px-8 md:py-6">
      <input id="ac-drawer-toggle" className="ac-drawer-input" type="checkbox" aria-hidden="true" />
      <div className="mx-auto w-full max-w-[318px] overflow-x-hidden sm:max-w-[420px] md:max-w-3xl lg:max-w-5xl xl:max-w-7xl">
        <header className="relative z-10 flex items-center justify-between gap-4">
          <Link href="/" className="flex min-w-0 items-center">
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
            <a href="/partner/landing" className="rounded-full bg-white/8 px-4 py-2 transition hover:bg-white/12">
              Партнёрам
            </a>
            <a href="/login" className="rounded-full bg-white/8 px-4 py-2 transition hover:bg-white/12">
              Вход
            </a>
          </nav>

          <label htmlFor="ac-drawer-toggle" className="ac-drawer-burger md:hidden" aria-label="Открыть меню">
            <svg width="19" height="14" viewBox="0 0 19 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 1H18M1 7H18M1 13H18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </label>
        </header>

        <section className="grid w-full min-w-0 items-start justify-items-center gap-6 pt-5 xl:grid-cols-[minmax(0,1fr)_500px] xl:justify-items-stretch xl:gap-10 xl:pt-8">
          <div className="relative z-10 order-1 w-full min-w-0">
            <h1 className="text-[28px] font-black leading-[0.98] tracking-[-0.035em] text-white sm:text-[40px] md:text-[56px] lg:text-[72px] xl:text-[92px]">
              <span className="block">Узнайте АвтоЦену</span>
              <span className="block">за 30 секунд</span>
            </h1>

            <p className="mt-3 text-[15px] font-medium leading-7 text-white/72 md:mt-5 md:max-w-2xl md:text-[18px] md:leading-8 lg:text-[20px]">
              Укажите бюджет, марку и год. Сервис покажет, что реально можно
              привезти под ключ.
            </p>

            <div className="mt-4 w-full max-w-full overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mt-5 lg:overflow-visible">
              <div className="flex w-max snap-x snap-mandatory gap-3 lg:w-auto lg:flex-wrap">
                {budgetChips.map((chip) => {
                  const active = budgetNumber === chip;

                  return (
                    <button
                      key={chip}
                      onClick={() => applyBudget(chip)}
                      className={[
                        "snap-start whitespace-nowrap rounded-full border px-5 py-3 text-sm font-black transition",
                        active
                          ? "border-red-400 bg-red-500 text-white shadow-[0_0_30px_rgba(239,68,68,0.24)]"
                          : "border-white/28 bg-transparent text-white hover:border-white/50 hover:bg-white/6"
                      ].join(" ")}
                    >
                      до {formatMoney(chip)} ₽
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div
            id="form"
            className="order-2 glass relative mx-auto box-border w-full max-w-[318px] overflow-hidden rounded-[1.35rem] border border-white/12 bg-white/[0.06] p-3 shadow-[0_20px_80px_rgba(255,0,76,0.12)] sm:max-w-[420px] sm:rounded-[1.7rem] sm:p-4 xl:max-w-none xl:rounded-[2rem] xl:p-6"
          >
            <div className="mb-3 flex items-center justify-between gap-3 xl:mb-4">
              <div className="text-[13px] font-bold uppercase tracking-[0.14em] text-red-200/90">
                Бюджет
              </div>

              <div className="shrink-0 rounded-full border border-white/14 bg-white/8 px-3 py-1.5 text-[11px] font-black text-white/60 sm:text-xs">
                результат за 30 секунд
              </div>
            </div>

            <div className="rounded-[1.1rem] border border-white/10 bg-white/[0.06] p-4 sm:rounded-[1.2rem] xl:rounded-[1.4rem] xl:p-5">
              <div className="flex min-w-0 items-center justify-between gap-3 xl:gap-4">
                <input
                  value={budget ? formatMoney(Number(budget || 0)) : ""}
                  onChange={(event) => handleBudgetChange(event.target.value)}
                  inputMode="numeric"
                  placeholder="Введите бюджет"
                  className="min-w-0 flex-1 bg-transparent text-[29px] font-black tracking-[-0.05em] text-white outline-none placeholder:text-white/20 sm:text-[36px] md:text-[46px] xl:text-[58px]"
                />

                <div className="shrink-0 text-[25px] font-black text-white/48 sm:text-[30px] md:text-[36px] xl:text-[44px]">
                  ₽
                </div>
              </div>
            </div>

            <div className="mt-3 grid min-w-0 grid-cols-2 gap-2 sm:gap-3 xl:mt-4">
              <SelectField value={brand} onChange={setBrand} options={brandOptions} />
              <SelectField value={model} onChange={setModel} options={modelOptions} />
              <SelectField value={yearFrom} onChange={setYearFrom} options={yearOptions} />
              <SelectField value={country} onChange={setCountry} options={countryOptions} />

              <div className="col-span-2 min-w-0">
                <SelectField value={bodyType} onChange={setBodyType} options={bodyOptions} />
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
        </section>

        <section className="mx-auto mt-6 w-full min-w-0 border-t border-white/10 pt-5 xl:mt-8 xl:pt-6">
          <div className="grid gap-3 md:grid-cols-3">
            <BenefitCard
              icon="fast"
              title="Без регистрации"
              text="Сразу получите первую выдачу по вашему бюджету."
            />

            <BenefitCard
              icon="globe"
              title="Япония · Китай · Корея · ОАЭ · Европа"
              text="Сравниваем основные рынки поставки и показываем варианты."
            />

            <BenefitCard
              icon="delivery"
              title="Доставка, таможня и оформление"
              text="В расчёт включается вся ключевая структура цены под ключ."
            />
          </div>

          <TopAvtoExecutorBlock />
        </section>
      </div>

      <label htmlFor="ac-drawer-toggle" className="ac-drawer-backdrop md:hidden" aria-label="Закрыть меню" />

      <aside className="ac-drawer-panel md:hidden" aria-label="Мобильное меню">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-lg font-black leading-none">
              <span className="text-red-500">Авто</span>
              <span className="text-white">Цена</span>
            </div>
            <div className="mt-1 text-xs font-bold text-white/42">меню</div>
          </div>

          <label htmlFor="ac-drawer-toggle" className="ac-drawer-close" aria-label="Закрыть меню">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 2L14 14M14 2L2 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </label>
        </div>

        <nav className="mt-8 grid gap-3">
          <Link href="/partner/landing" className="ac-drawer-link">
            <span>Партнёрам</span>
            <span className="ac-drawer-icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M7.5 12.2L10.2 9.5C11 8.7 12.2 8.7 13 9.5L14.5 11C15.2 11.7 16.3 11.7 17 11L18.2 9.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3.5 12.5L7.3 16.3C8.1 17.1 9.4 17.1 10.2 16.3L11 15.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M20.5 12.5L16.7 16.3C15.9 17.1 14.6 17.1 13.8 16.3L9.8 12.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3 9.5L6.5 6H9.5M21 9.5L17.5 6H14.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </Link>

          <Link href="/login" className="ac-drawer-link ac-drawer-link--red">
            <span>Вход</span>
            <span className="ac-drawer-icon ac-drawer-icon--red" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 9H14M10 5L14 9L10 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </Link>
        </nav>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm font-medium leading-6 text-white/55">
          Для менеджеров TopAvto и партнёров. CRM и CPA API доступны только после входа.
        </div>
      </aside>

    </main>
  );
}
