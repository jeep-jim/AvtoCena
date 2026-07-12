"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BrandMark } from "@/components/brand/BrandMark";

const START_EVENT = "avtocena:navigation-start";
const MIN_VISIBLE_MS = 260;
const MAX_VISIBLE_MS = 8000;

export function startRoutePreloader() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(START_EVENT));
  }
}

function sameDocumentHashNavigation(anchor: HTMLAnchorElement, url: URL) {
  return (
    url.pathname === window.location.pathname &&
    url.search === window.location.search &&
    Boolean(url.hash)
  );
}

function RoutePreloaderInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const startedAtRef = useRef(0);
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const previousRouteKeyRef = useRef(routeKey);
  const warmedRoutesRef = useRef(new Set<string>());
  const hideTimerRef = useRef<number | null>(null);
  const safetyTimerRef = useRef<number | null>(null);

  function clearTimers() {
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    if (safetyTimerRef.current !== null) window.clearTimeout(safetyTimerRef.current);
    hideTimerRef.current = null;
    safetyTimerRef.current = null;
  }

  function show() {
    clearTimers();
    startedAtRef.current = performance.now();
    setVisible(true);
    safetyTimerRef.current = window.setTimeout(() => setVisible(false), MAX_VISIBLE_MS);
  }

  useEffect(() => {
    function handleStart() {
      show();
    }

    function handleClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const target = event.target as Element | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || sameDocumentHashNavigation(anchor, url)) return;

      const current = `${window.location.pathname}${window.location.search}`;
      const next = `${url.pathname}${url.search}`;
      if (current === next) return;

      show();
    }

    function handleSubmit(event: SubmitEvent) {
      const form = event.target as HTMLFormElement | null;
      if (!form || form.dataset.noRouteLoader === "true" || form.target === "_blank") return;
      show();
    }

    function handleWarmRoute(event: Event) {
      const target = event.target as Element | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || sameDocumentHashNavigation(anchor, url)) return;
      const route = `${url.pathname}${url.search}`;
      if (warmedRoutesRef.current.has(route)) return;
      warmedRoutesRef.current.add(route);
      router.prefetch(route);
    }

    window.addEventListener(START_EVENT, handleStart);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("submit", handleSubmit, true);
    document.addEventListener("pointerover", handleWarmRoute, true);
    document.addEventListener("focusin", handleWarmRoute, true);

    return () => {
      window.removeEventListener(START_EVENT, handleStart);
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("submit", handleSubmit, true);
      document.removeEventListener("pointerover", handleWarmRoute, true);
      document.removeEventListener("focusin", handleWarmRoute, true);
      clearTimers();
    };
  }, [router]);

  useEffect(() => {
    if (previousRouteKeyRef.current === routeKey) return;
    previousRouteKeyRef.current = routeKey;
    if (!visible) return;

    const elapsed = performance.now() - startedAtRef.current;
    const delay = Math.max(0, MIN_VISIBLE_MS - elapsed);

    hideTimerRef.current = window.setTimeout(() => {
      setVisible(false);
      clearTimers();
    }, delay);
  }, [routeKey, visible]);

  return (
    <div
      className={[
        "ac-route-loader fixed inset-0 z-[2147483646] grid place-items-center bg-[#080a11]/88 px-6 backdrop-blur-xl transition-opacity duration-200",
        visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
      ].join(" ")}
      aria-hidden={!visible}
      aria-live="polite"
    >
      <div className="flex flex-col items-center text-center">
        <div className="ac-route-loader__mark relative grid h-24 w-24 place-items-center rounded-[2rem] border border-white/12 bg-white/[0.06] shadow-[0_24px_80px_rgba(0,0,0,0.42)]">
          <BrandMark className="h-16 w-16" />
        </div>

        <div className="mt-5 grid grid-cols-4 gap-2" aria-hidden="true">
          {["+", "−", "=", "₽"].map((symbol, index) => (
            <span
              key={symbol}
              className="ac-route-loader__key grid h-9 w-9 place-items-center rounded-xl border border-white/12 bg-white/[0.075] text-base font-black text-white"
              style={{ animationDelay: `${index * 150}ms` }}
            >
              {symbol}
            </span>
          ))}
        </div>

        <div className="mt-4 text-sm font-black text-white">Загружаем раздел</div>
        <div className="mt-1 text-xs font-bold text-white/45">АвтоЦена уже считает следующий шаг</div>
      </div>
    </div>
  );
}

export function RoutePreloader() {
  return (
    <Suspense fallback={null}>
      <RoutePreloaderInner />
    </Suspense>
  );
}
