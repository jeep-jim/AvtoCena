"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, type ReactNode } from "react";

// Prefetch only on interaction; background detail requests compete with photos.

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

  return <Link
    href={href}
    prefetch={false}
    className={className}
    onPointerEnter={prefetch}
    onFocus={prefetch}

    onPointerDown={prefetch}
  >{children}</Link>;
}
