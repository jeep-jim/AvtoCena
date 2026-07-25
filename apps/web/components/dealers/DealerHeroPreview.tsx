"use client";

import { useEffect, useMemo, useState } from "react";

const applications = [
  { city: "Новокузнецк", request: "Кроссовер до 2 млн ₽, левый руль, не старше 2021 года.", status: "Новая", tone: "new", meta: "только что · сайт" },
  { city: "Кемерово", request: "Toyota или Honda из Японии до 1,4 млн ₽, пробег до 90 000 км.", status: "В работе", tone: "work", meta: "ответил Иван · 4 мин" },
  { city: "Барнаул", request: "Новый кроссовер из Китая до 2,8 млн ₽. Нужен полный расчёт.", status: "Расчёт готов", tone: "ready", meta: "3 автомобиля отправлены" },
  { city: "Томск", request: "Kia Sorento из Кореи, дизель, полный привод, бюджет до 3,5 млн ₽.", status: "Сделка", tone: "deal", meta: "внесён депозит" },
  { city: "Новосибирск", request: "BMW 3 из Китая до 3,2 млн ₽, тёмный салон и небольшой пробег.", status: "Без ответа", tone: "late", meta: "ожидает менеджера · 11 мин" },
] as const;

const toneClasses: Record<string, string> = {
  new: "dealer-status-chip--new",
  work: "dealer-status-chip--work",
  ready: "dealer-status-chip--ready",
  deal: "dealer-status-chip--deal",
  late: "dealer-status-chip--late",
};

export function DealerHeroPreview() {
  const [active, setActive] = useState(0);
  const visible = useMemo(() => [applications[active], applications[(active + 1) % applications.length], applications[(active + 2) % applications.length]], [active]);

  useEffect(() => {
    const timer = window.setInterval(() => setActive((current) => (current - 1 + applications.length) % applications.length), 8200);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="dealer-hero-preview rounded-[2rem] border border-white/8 bg-[#12151d] p-5 md:p-7 lg:-translate-y-8">
      <div className="flex items-center justify-between gap-4">
        <div><div className="text-xs font-black uppercase tracking-[.16em] text-red-400">Рабочее место дилера</div><h2 className="mt-2 text-3xl font-black tracking-[-.04em]">Вся компания в одном окне</h2></div>
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-red-500 text-2xl">⚡</div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {[["Новые заявки", "18"], ["Без ответа", "3"], ["Клиенты в работе", "47"], ["Автомобили в пути", "12"]].map(([label, value]) => <div key={label} className="dealer-metric-card rounded-2xl bg-white/[.055] p-4"><div className="text-xs font-bold text-white/52">{label}</div><div className="mt-2 text-4xl font-black">{value}</div></div>)}
      </div>

      <div className="relative mt-3 min-h-[290px] overflow-hidden rounded-2xl bg-white/[.035] p-3">
        <div className="mb-2 flex items-center justify-between px-1 text-[11px] font-black uppercase tracking-[.12em] text-white/48"><span>Последние обращения</span><span className="inline-flex items-center gap-1.5 text-[#20a85e]"><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#20a85e]" />обновляется</span></div>
        <div key={active} className="grid gap-2 dealer-preview-slide">
          {visible.map((item, index) => <article key={`${item.city}-${active}-${index}`} className="dealer-application-card rounded-2xl bg-white/[.065] p-3.5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-sm font-black">Заявка из {item.city}</div><div className="mt-1 text-xs font-bold text-white/48">{item.meta}</div></div><span className={`dealer-status-chip shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${toneClasses[item.tone]}`}>{item.status}</span></div><p className="mt-2 text-xs font-bold leading-5 text-white/62">{item.request}</p></article>)}
        </div>
      </div>

      <style jsx>{`
        .dealer-preview-slide { animation: dealerPreviewDown .7s cubic-bezier(.22,.78,.24,1) both; }
        @keyframes dealerPreviewDown { from { opacity: .15; transform: translateY(-88px); } to { opacity: 1; transform: translateY(0); } }
        @media (prefers-reduced-motion: reduce) { .dealer-preview-slide { animation: none; } }
      `}</style>
    </div>
  );
}
