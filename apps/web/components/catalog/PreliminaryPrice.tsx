"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";

const PRELIMINARY_PRICE_INFO = "Предварительный расчёт: платежи, зависящие от неподтверждённой мощности силовой установки, пока не включены. Финальную стоимость подтвердит менеджер.";

function money(value: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(value));
}

export function PreliminaryPrice({
  offer,
  label,
  dense = false,
  priceClassName = "text-[22px]",
  className = "",
  panel = false,
  highlightElectrified = false,
}: {
  offer: any;
  label: string;
  dense?: boolean;
  priceClassName?: string;
  className?: string;
  panel?: boolean;
  highlightElectrified?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [desktopHover, setDesktopHover] = useState(false);
  const [lightTheme, setLightTheme] = useState(() => typeof document !== "undefined" && document.documentElement.dataset.theme === "light");
  const rootRef = useRef<HTMLDivElement>(null);
  const totalRub = Number(offer?.totalRub || 0);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px) and (hover: hover) and (pointer: fine)");
    const sync = () => { setDesktopHover(media.matches); if (!media.matches) setOpen(false); };
    sync();
    media.addEventListener?.("change", sync);
    return () => media.removeEventListener?.("change", sync);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setLightTheme(root.dataset.theme === "light");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  const electrifiedPanelBackground = lightTheme ? "rgba(197, 138, 0, 0.10)" : "rgba(255, 210, 31, 0.14)";

  useEffect(() => {
    const node = rootRef.current;
    if (!node || !panel || !highlightElectrified) return;
    node.style.setProperty("background", electrifiedPanelBackground, "important");
    node.style.setProperty("background-color", electrifiedPanelBackground, "important");
    return () => {
      node.style.removeProperty("background");
      node.style.removeProperty("background-color");
    };
  }, [panel, highlightElectrified, electrifiedPanelBackground]);

  const panelBackground = highlightElectrified
    ? electrifiedPanelBackground
    : lightTheme
      ? "#ffffff"
      : "var(--ac-surface-2)";
  const panelText = "var(--ac-text)";
  const priceColor = highlightElectrified ? (lightTheme ? "#c58a00" : "#ffd21f") : "var(--ac-text)";
  const popoverClass = lightTheme
    ? "border-[#d8dee8] bg-[#f8f9fb] text-[#303744] shadow-[0_12px_34px_rgba(38,43,57,.14)]"
    : "border-white/10 bg-[#181b24] text-white/78 shadow-[0_20px_65px_rgba(0,0,0,.45)]";

  const togglePanelInfo = (event: ReactMouseEvent | ReactKeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setOpen((current) => !current);
  };

  return (
    <div
      ref={rootRef}
      className={`relative ${panel ? "ac-price-trend-panel ac-preliminary-price-panel cursor-pointer rounded-[1.35rem] p-4 pr-16 shadow-[0_14px_38px_rgba(0,0,0,.14)]" : ""} ${className}`}
      style={panel ? { background: panelBackground, backgroundColor: panelBackground } : undefined}
      role={panel ? "button" : undefined}
      tabIndex={panel ? 0 : undefined}
      aria-expanded={panel ? open : undefined}
      onClick={panel ? togglePanelInfo : undefined}
      onKeyDown={panel ? (event) => { if (event.key === "Enter" || event.key === " ") togglePanelInfo(event); } : undefined}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className={`${dense ? "text-[8px] sm:text-[10px]" : panel ? "text-[10px] md:text-[11px]" : "text-[10px]"} ac-price-trend-label min-w-0 font-black uppercase tracking-[0.19em]`} style={{ color: panel ? panelText : undefined }}>
          {label}
        </div>
        {!panel ? <span aria-hidden="true" className={`${dense ? "text-[9px] sm:text-xs" : "text-xs md:text-sm"} invisible shrink-0 font-black leading-none`}>+0K</span> : null}
      </div>
      <div className={`${dense ? "mt-1 gap-1 sm:mt-1.5 sm:gap-3" : "mt-1.5 gap-3"} flex min-w-0 items-end justify-between`}>
        <div className={`ac-price ac-price--preliminary ${highlightElectrified ? "ac-price--electrified" : ""} min-w-0 whitespace-nowrap font-black leading-none tracking-[-0.05em] ${priceClassName}`} style={{ color: priceColor }}>
          {totalRub > 0 ? <><span>{money(totalRub)}</span><span className="ml-[0.18em] inline-block translate-y-[-0.03em] text-[0.58em] tracking-[-0.02em]">₽</span></> : "Цена по запросу"}
        </div>
        {!panel ? <span aria-hidden="true" className="invisible relative flex shrink-0 items-center rounded-lg pb-0.5"><svg className={dense ? "h-5 w-7 sm:h-6 sm:w-8" : "h-6 w-8 md:h-7 md:w-10"} viewBox="0 0 38 29" /></span> : null}
      </div>

      {panel ? <>
        <span
          role="button"
          tabIndex={0}
          aria-label="Почему цена предварительная"
          aria-expanded={open}
          className="absolute right-4 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-sm font-black outline-none"
          style={{ background: "var(--ac-surface-3)", border: "1px solid rgba(103,113,130,.45)", color: "var(--ac-text)" }}
          onMouseEnter={() => { if (desktopHover) setOpen(true); }}
          onMouseLeave={() => { if (desktopHover) setOpen(false); }}
          onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen((current) => !current);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              setOpen((current) => !current);
            }
          }}
        >
          ?
        </span>
        {open ? (
          <div
            className={`ac-preliminary-price-popover absolute left-0 right-0 top-[calc(100%+10px)] z-[400] w-full rounded-2xl border p-4 text-left text-xs font-bold leading-5 sm:left-auto sm:right-0 sm:top-[calc(100%+12px)] sm:w-[min(430px,calc(100vw-48px))] ${popoverClass}`}
            role="tooltip"
            onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
          >
            {PRELIMINARY_PRICE_INFO}
          </div>
        ) : null}
      </> : null}
    </div>
  );
}
