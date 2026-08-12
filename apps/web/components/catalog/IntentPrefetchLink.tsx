"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, type ReactNode } from "react";

const EAGER_PREFETCH_DELAY_MS = 120;

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
    // Only the first four visible catalog cards opt into eager warming. Start
    // almost immediately after hydration so a normal mobile tap can reuse the
    // prepared RSC route instead of starting its first Object Storage read on
    // pointer-down. Four requests fit the provisioned container concurrency.
    const timer = window.setTimeout(prefetch, EAGER_PREFETCH_DELAY_MS);
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
