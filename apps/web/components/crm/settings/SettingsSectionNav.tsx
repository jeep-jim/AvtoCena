"use client";

import { useEffect, useState } from "react";

const sections = [
  ["markets", "Рынки"],
  ["calculations", "Расчёт и расходы"],
  ["stages", "Этапы сделки"],
  ["partners", "Партнёрские выплаты"],
  ["cpa", "CPA-сети"],
  ["site", "Настройки сайта"],
  ["contracts", "Договоры и шаблоны"],
  ["history", "История изменений"],
] as const;

export function SettingsSectionNav() {
  const [activeSection, setActiveSection] =
    useState<(typeof sections)[number][0]>("markets");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (visible?.target.id) {
          setActiveSection(visible.target.id as (typeof sections)[number][0]);
        }
      },
      { rootMargin: "-140px 0px -55% 0px", threshold: [0.12, 0.28, 0.5] },
    );

    sections.forEach(([id]) => {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    });

    return () => observer.disconnect();
  }, []);

  return (
    <nav
      aria-label="Разделы бизнес-настроек"
      className="sticky top-0 z-30 -mx-4 mb-5 border-y border-white/10 bg-[#080910]/90 px-4 py-3 shadow-2xl shadow-black/35 backdrop-blur-xl supports-[backdrop-filter]:bg-[#080910]/75 md:top-2 md:mx-0 md:rounded-3xl md:border md:px-3"
    >
      <div className="flex gap-2 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sections.map(([id, label]) => {
          const active = activeSection === id;

          return (
            <a
              key={id}
              href={`#${id}`}
              aria-current={active ? "true" : undefined}
              onClick={() => setActiveSection(id)}
              className={[
                "shrink-0 rounded-full border px-4 py-2 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300/80",
                active
                  ? "border-red-400/70 bg-red-600 text-white shadow-lg shadow-red-950/30"
                  : "border-white/10 bg-white/[0.07] text-white/58 hover:border-white/20 hover:bg-white/12 hover:text-white/85",
              ].join(" ")}
            >
              {label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
