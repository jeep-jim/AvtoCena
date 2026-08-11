"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, type ReactNode } from "react";

export function IntentPrefetchLink({ href, className, children, eager = false }: {
  href: string;
  className?: string;
  children: ReactNode;
  eager?: boolean;
}) {
  const router = useRouter();
  const prefetched = useRef(false);

  const prefetch = useCallback(() => {
    if (prefetched.current) return;
    prefetched.current = true;
    router.prefetch(href);
  }, [href, router]);

  useEffect(() => {
    if (!eager) return;
    // Warm only the first visible row after the catalog becomes interactive.
    // Four requests fit the provisioned container concurrency and make a normal
    // mobile tap reuse the prepared offer route.
    const timer = window.setTimeout(prefetch, 1_200);
    return () => window.clearTimeout(timer);
  }, [eager, prefetch]);

  return <Link
    href={href}
    prefetch={false}
    className={className}
    onPointerEnter={prefetch}
    onFocus={prefetch}
    onTouchStart={prefetch}
    onPointerDown={prefetch}
  >{children}</Link>;
}
