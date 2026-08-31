"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const YANDEX_METRIKA_COUNTER_ID = 112098062;

declare global {
  interface Window {
    ym?: (...args: unknown[]) => void;
  }
}

function RouteTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialized = useRef(false);
  const previousUrl = useRef("");
  const query = searchParams.toString();

  useEffect(() => {
    const currentUrl = `${window.location.origin}${pathname}${query ? `?${query}` : ""}`;

    if (!initialized.current) {
      initialized.current = true;
      previousUrl.current = currentUrl;
      return;
    }

    window.ym?.(YANDEX_METRIKA_COUNTER_ID, "hit", currentUrl, {
      referer: previousUrl.current,
    });
    previousUrl.current = currentUrl;
  }, [pathname, query]);

  return null;
}

export function YandexMetrikaRouteTracker() {
  return (
    <Suspense fallback={null}>
      <RouteTracker />
    </Suspense>
  );
}
