"use client";

import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { Gavel } from "lucide-react";

type AuctionCardPriceProps = {
  offer: any;
  label: string;
  dense?: boolean;
  priceClassName?: string;
};

function money(value: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(value));
}

export function AuctionCardPrice({ offer, label, dense = false, priceClassName = "text-[22px]" }: AuctionCardPriceProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const totalRub = Number(offer?.totalRub || 0);
  const auctionDate = String(offer?.auctionDate || "").trim();
  const dateLabel = auctionDate && !Number.isNaN(Date.parse(auctionDate))
    ? new Date(auctionDate).toLocaleDateString("ru-RU")
    : "";

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  const stopPointer = (event: SyntheticEvent) => {
    event.stopPropagation();
  };
  const swallowClick = (event: SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return <div ref={rootRef} className="ac-auction-card-price relative min-w-0">
    <div className={`${dense ? "text-[8px] sm:text-[10px]" : "text-[10px]"} ac-price-trend-label min-w-0 font-black uppercase tracking-[0.19em] text-[var(--ac-text)]`}>
      {label}
    </div>
    <div className={`${dense ? "mt-1 gap-1 sm:mt-1.5 sm:gap-3" : "mt-1.5 gap-3"} flex min-w-0 items-end justify-between`}>
      <div className={`ac-price ac-price--flat min-w-0 font-black leading-none tracking-[-0.05em] text-[var(--ac-text)] ${totalRub ? "whitespace-nowrap" : "break-words"} ${priceClassName}`}>
        {totalRub ? <><span>{money(totalRub)}</span><span className="ml-[0.18em] inline-block translate-y-[-0.03em] text-[0.58em] tracking-[-0.02em]">₽</span></> : "Цена по запросу"}
      </div>
      <div
        className="relative shrink-0"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <button
          type="button"
          aria-label="Что означает завершённый аукционный лот"
          aria-expanded={open}
          className="ac-auction-gavel flex shrink-0 touch-manipulation items-center justify-center rounded-lg bg-transparent p-0.5 text-[var(--ac-text)] outline-none transition-opacity hover:opacity-70 focus-visible:ring-2 focus-visible:ring-current/45"
          onPointerDownCapture={stopPointer}
          onPointerUpCapture={stopPointer}
          onClickCapture={(event) => {
            swallowClick(event);
            setOpen((current) => !current);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            setOpen((current) => !current);
          }}
        >
          <Gavel className={dense ? "h-5 w-5 sm:h-6 sm:w-6" : "h-7 w-7"} strokeWidth={2.35} aria-hidden="true" />
        </button>
        {open ? <div
          role="tooltip"
          className="ac-price-trend-popover absolute bottom-[calc(100%+10px)] right-0 z-[12020] w-[min(320px,calc(100vw-24px))] rounded-2xl border border-[var(--ac-border)] bg-[var(--ac-surface)] p-3.5 text-left text-xs font-bold leading-5 text-[var(--ac-text)] shadow-[0_20px_65px_rgba(0,0,0,.35)]"
          onPointerDownCapture={stopPointer}
          onClickCapture={swallowClick}
        >
          Завершённый аукционный лот{dateLabel ? ` от ${dateLabel}` : ""}. Показана стоимость под ключ, рассчитанная по цене продажи и курсу, сохранённому для этого лота. Текущий курс её не изменяет.
          <span className="absolute -bottom-1.5 right-2.5 h-3 w-3 rotate-45 border-b border-r border-[var(--ac-border)] bg-[var(--ac-surface)]" aria-hidden="true" />
        </div> : null}
      </div>
    </div>
  </div>;
}
