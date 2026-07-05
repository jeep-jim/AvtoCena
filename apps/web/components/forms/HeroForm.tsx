"use client";

import { useState } from "react";

export function HeroForm() {
  const [budget, setBudget] = useState("");

  function submit() {
    const params = new URLSearchParams({ budget });
    window.location.href = `/results?${params.toString()}`;
  }

  return (
    <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-xl md:p-8">
      <label className="block text-sm font-bold text-neutral-500">Ваш бюджет</label>
      <input
        value={budget}
        onChange={(e) => setBudget(e.target.value)}
        placeholder="Например, 3 000 000 ₽"
        className="mt-2 w-full rounded-2xl border border-neutral-200 px-5 py-5 text-3xl font-black outline-none focus:border-brand-red"
      />

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <input placeholder="Марка — необязательно" className="rounded-2xl border border-neutral-200 px-4 py-4 outline-none" />
        <input placeholder="Год от" className="rounded-2xl border border-neutral-200 px-4 py-4 outline-none" />
        <select className="rounded-2xl border border-neutral-200 px-4 py-4 outline-none">
          <option>Страна не важна</option>
          <option>Япония</option>
          <option>Китай</option>
          <option>Корея</option>
          <option>ОАЭ</option>
          <option>Европа</option>
        </select>
      </div>

      <button onClick={submit} className="mt-6 w-full rounded-2xl bg-brand-red px-6 py-5 text-xl font-black text-white">
        Узнать АвтоЦену
      </button>
    </div>
  );
}
