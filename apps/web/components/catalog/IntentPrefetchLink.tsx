"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, type ReactNode } from "react";

// Prefetch only on interaction; background detail requests compete with photos.

export function IntentPrefetchLink({ href, className, children, eager = false }: {
  href: string;
  className?: string;
  children: ReactNode;
  eager?: boolean;
}) {
  const router = useRouter();
  const prefetched = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => cancel, [href, cancel]);
  const prefetch = useCallback(() => {
    cancel();
    if (href.includes('--ajes-stats-') || href.includes('/ajes-stats-') || prefetched.current === href) return;
    prefetched.current = href;
    router.prefetch(href);
  }, [href, router, cancel]);
  const hover = useCallback((event: {pointerType: string}) => {
    cancel();
    if (event.pointerType !== "mouse" || prefetched.current === href) return;
    timer.current = setTimeout(prefetch, 180);
  }, [href, prefetch, cancel]);

  return <Link
    href={href}
    prefetch={false}
    className={className}
    data-intent-prefetch="true"
    onPointerEnter={hover}
    onPointerLeave={cancel}
    onBlur={cancel}
    onFocus={prefetch}

    // A finger touching a card is usually the start of a scroll, not navigation.
    // Do not start detail reads for every card touched during a mobile fling.
    onPointerDown={event => { if (event.pointerType === "mouse") prefetch(); }}
  >{children}</Link>;
}
