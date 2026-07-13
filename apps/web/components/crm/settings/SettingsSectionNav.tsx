"use client";

import { MouseEvent, useCallback, useEffect, useState } from "react";

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

  const openParentDetailsAndScroll = useCallback(
    (id: (typeof sections)[number][0]) => {
      const element = document.getElementById(id);
      if (!element) return;

      const parentDetails = element.closest("details");
      if (parentDetails && !parentDetails.open) {
        parentDetails.open = true;
      }

      window.requestAnimationFrame(() => {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [],
  );

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

  useEffect(() => {
    const scrollToHashTarget = () => {
      const id = window.location.hash.slice(1) as (typeof sections)[number][0];
      if (!sections.some(([sectionId]) => sectionId === id)) return;

      setActiveSection(id);
      openParentDetailsAndScroll(id);
    };

    scrollToHashTarget();
    window.addEventListener("hashchange", scrollToHashTarget);

    return () => window.removeEventListener("hashchange", scrollToHashTarget);
  }, [openParentDetailsAndScroll]);

  const handleNavClick = (
    event: MouseEvent<HTMLAnchorElement>,
    id: (typeof sections)[number][0],
  ) => {
    event.preventDefault();
    window.history.pushState(null, "", `#${id}`);
    setActiveSection(id);
    openParentDetailsAndScroll(id);
  };

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
              onClick={(event) => handleNavClick(event, id)}
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
