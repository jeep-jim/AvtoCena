"use client";

import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";

type Hosts = {
  desktop: HTMLElement | null;
  mobile: HTMLElement | null;
};

function ChatIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5.5 5.25h13A2.25 2.25 0 0 1 20.75 7.5v8A2.25 2.25 0 0 1 18.5 17.75h-7.25L6 21v-3.25h-.5a2.25 2.25 0 0 1-2.25-2.25v-8A2.25 2.25 0 0 1 5.5 5.25Z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8" cy="11.5" r=".85" fill="currentColor" />
      <circle cx="12" cy="11.5" r=".85" fill="currentColor" />
      <circle cx="16" cy="11.5" r=".85" fill="currentColor" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7.15 3.75 10 8.35 8.3 10.1a14.9 14.9 0 0 0 5.6 5.6l1.75-1.7 4.6 2.85c.5.3.7.92.48 1.46-.56 1.38-1.83 2.3-3.31 2.4C10.08 21.13 2.87 13.92 3.29 6.58c.1-1.48 1.02-2.75 2.4-3.31.54-.22 1.16-.02 1.46.48Z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ActionButtons({ className = "", stacked = false }: { className?: string; stacked?: boolean }) {
  const buttonClass = "ac-offer-contact-button relative inline-flex h-[54px] min-w-0 items-center justify-center rounded-[1.05rem] px-2 text-[12px] font-black leading-none !text-white transition-[filter,transform] hover:brightness-95 active:scale-[.99] sm:px-3 sm:text-sm md:px-12 md:text-base xl:h-14";
  return (
    <div className={`grid ${stacked ? "grid-cols-1 gap-3" : "grid-cols-2 gap-3 md:gap-4"} ${className}`}>
      <button
        type="button"
        data-offer-action="messenger"
        className={`${buttonClass} bg-[#00A2E8]`}
      >
        <span className="pointer-events-none absolute left-4 hidden items-center justify-center md:inline-flex xl:left-5"><ChatIcon /></span>
        <span className="whitespace-nowrap">Чат в мессенджере</span>
      </button>
      <button
        type="button"
        data-offer-action="lead"
        className={`${buttonClass} bg-[#22B14C]`}
      >
        <span className="whitespace-nowrap">Оставить заявку</span>
        <span className="pointer-events-none absolute right-4 hidden items-center justify-center md:inline-flex xl:right-5"><PhoneIcon /></span>
      </button>
    </div>
  );
}

function MobilePinnedActions() {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [fixedStyle, setFixedStyle] = useState<CSSProperties | null>(null);

  useEffect(() => {
    let frame = 0;

    const update = () => {
      frame = 0;
      const anchor = anchorRef.current;
      if (!anchor || window.innerWidth >= 1280) {
        setFixedStyle(null);
        return;
      }

      const rect = anchor.getBoundingClientRect();
      const header = document.querySelector<HTMLElement>(".ac-public-header");
      const headerBottom = header ? Math.max(0, header.getBoundingClientRect().bottom) : 64;
      const fixedTop = headerBottom + 8;
      const shouldFix = rect.top <= fixedTop;

      setFixedStyle(shouldFix ? {
        position: "fixed",
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        top: `${fixedTop}px`,
        zIndex: 45,
      } : null);
    };

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={anchorRef} className="relative mt-4 h-[54px] xl:hidden">
      <div
        style={fixedStyle || undefined}
        className={`ac-offer-pinned-actions w-full ${fixedStyle ? "is-fixed" : ""}`}
      >
        <ActionButtons />
      </div>
    </div>
  );
}

export function OfferContactActions() {
  const pathname = usePathname();
  const [hosts, setHosts] = useState<Hosts>({ desktop: null, mobile: null });

  useEffect(() => {
    document.querySelectorAll<HTMLElement>("[data-offer-actions-host]").forEach((node) => node.remove());
    setHosts({ desktop: null, mobile: null });

    if (!pathname?.startsWith("/cars/offer/")) return;

    let cancelled = false;
    let frame = 0;
    let desktopHost: HTMLElement | null = null;
    let mobileHost: HTMLElement | null = null;

    const mount = () => {
      if (cancelled) return;
      const page = document.querySelector<HTMLElement>("main.ac-offer-page");
      const section = page?.querySelector<HTMLElement>(":scope > section");
      const grid = section?.querySelector<HTMLElement>(":scope > div.grid");
      const mediaColumn = grid?.children?.[0] as HTMLElement | undefined;
      const desktopSlot = page?.querySelector<HTMLElement>("[data-offer-desktop-actions-slot]");

      if (!page || !section || !grid || !mediaColumn) {
        frame = window.requestAnimationFrame(mount);
        return;
      }

      desktopHost = document.createElement("div");
      desktopHost.dataset.offerActionsHost = "desktop";
      (desktopSlot || mediaColumn).appendChild(desktopHost);

      mobileHost = document.createElement("div");
      mobileHost.dataset.offerActionsHost = "mobile";
      grid.insertAdjacentElement("afterend", mobileHost);

      if (!cancelled) setHosts({ desktop: desktopHost, mobile: mobileHost });
    };

    mount();

    return () => {
      cancelled = true;
      if (frame) window.cancelAnimationFrame(frame);
      desktopHost?.remove();
      mobileHost?.remove();
    };
  }, [pathname]);

  return (
    <>
      {hosts.desktop ? createPortal(<ActionButtons stacked className="mt-4 hidden xl:grid" />, hosts.desktop) : null}
      {hosts.mobile ? createPortal(<MobilePinnedActions />, hosts.mobile) : null}
      <style jsx global>{`
        .ac-offer-contact-button {
          color: #fff !important;
        }
        .ac-offer-pinned-actions {
          position: relative;
          isolation: isolate;
        }
        .ac-offer-pinned-actions.is-fixed::before {
          content: "";
          position: absolute;
          inset: -7px -6px;
          z-index: -1;
          pointer-events: none;
          border: 1px solid rgba(255,255,255,.08);
          border-radius: 1.35rem;
          background: rgba(26,32,41,.72);
          -webkit-backdrop-filter: blur(16px) saturate(125%);
          backdrop-filter: blur(16px) saturate(125%);
          box-shadow: 0 10px 30px rgba(0,0,0,.16);
        }
        html[data-theme="light"] .ac-offer-pinned-actions.is-fixed::before {
          border-color: rgba(35,42,55,.10);
          background: rgba(246,248,251,.78);
          box-shadow: 0 10px 28px rgba(38,43,57,.10);
        }
        .ac-offer-page > section > section {
          border-top: 1px solid rgba(255,255,255,.085) !important;
          padding-top: 1rem;
        }
        html[data-theme="light"] .ac-offer-page > section > section {
          border-top-color: rgba(35,42,55,.12) !important;
        }
      `}</style>
    </>
  );
}
