"use client";

import { useMemo, useState } from "react";

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function formatBudget(value: string) {
  const digits = onlyDigits(value);
  if (!digits) return "";
  return Number(digits).toLocaleString("ru-RU");
}

export function HeroForm() {
  const [budget, setBudget] = useState("3000000");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [yearFrom, setYearFrom] = useState("2020");
  const [market, setMarket] = useState("any");
  const [body, setBody] = useState("any");

  const budgetView = useMemo(() => formatBudget(budget), [budget]);

  function submit() {
    const params = new URLSearchParams();
    if (budget) params.set("budget", onlyDigits(budget));
    if (brand.trim()) params.set("brand", brand.trim());
    if (model.trim()) params.set("model", model.trim());
    if (yearFrom) params.set("yearFrom", yearFrom);
    if (market !== "any") params.set("market", market);
    if (body !== "any") params.set("body", body);

    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) params.set("ref", ref);

    window.location.href = `/cars?${params.toString()}`;
  }

  return (
    <div className="glass red-glow relative z-10 rounded-[2rem] p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.22em] text-red-300">главное поле</div>
          <label className="mt-1 block text-lg font-black text-white">Найдите автомобиль, который можно привезти под ваш бюджет</label>
        </div>
        <div className="hidden rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-bold text-white/75 md:block">
          результат за 30 секунд
        </div>
      </div>

      <div className="relative">
        <input
          inputMode="numeric"
          value={budgetView}
          onChange={(e) => setBudget(onlyDigits(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Например, 3 000 000"
          className="money-input w-full rounded-[1.6rem] px-5 py-6 pr-16 text-4xl font-black tracking-tight outline-none md:text-6xl"
        />
        <span className="pointer-events-none absolute right-6 top-1/2 -translate-y-1/2 text-3xl font-black text-white/45 md:text-5xl">₽</span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-5">
        <input
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          placeholder="Марка"
          className="soft-input rounded-2xl px-4 py-4 text-base font-bold"
        />
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="Модель"
          className="soft-input rounded-2xl px-4 py-4 text-base font-bold"
        />
        <input
          inputMode="numeric"
          value={yearFrom}
          onChange={(e) => setYearFrom(onlyDigits(e.target.value).slice(0, 4))}
          placeholder="Год от"
          className="soft-input rounded-2xl px-4 py-4 text-base font-bold"
        />
        <select value={market} onChange={(e) => setMarket(e.target.value)} className="soft-input rounded-2xl px-4 py-4 text-base font-bold">
          <option value="any">Страна не важна</option>
          <option value="china">Китай</option>
          <option value="japan">Япония</option>
          <option value="korea">Корея</option>
          <option value="uae">ОАЭ</option>
          <option value="europe">Европа</option>
        </select>
        <select value={body} onChange={(e) => setBody(e.target.value)} className="soft-input rounded-2xl px-4 py-4 text-base font-bold">
          <option value="any">Тип авто</option>
          <option value="sedan">Седан</option>
          <option value="crossover">Кроссовер</option>
          <option value="hatchback">Хэтчбек</option>
          <option value="suv">Внедорожник</option>
          <option value="minivan">Минивэн</option>
        </select>
      </div>

      <button onClick={submit} className="avto-button mt-4 w-full rounded-2xl px-6 py-5 text-xl font-black md:text-2xl">
        Показать автомобили
      </button>

      <div className="mt-4 grid gap-2 text-xs font-bold text-white/55 md:grid-cols-3">
        <div className="rounded-2xl bg-white/5 px-4 py-3">Без регистрации на первом шаге</div>
        <div className="rounded-2xl bg-white/5 px-4 py-3">Китай · Япония · Корея · ОАЭ</div>
        <div className="rounded-2xl bg-white/5 px-4 py-3">Доставка, таможня, утиль, оформление</div>
      </div>
    </div>
  );
}
