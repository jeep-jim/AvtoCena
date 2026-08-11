"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, type ReactNode } from "react";

export function IntentPrefetchLink({ href, className, children }: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const prefetched = useRef(false);

  const prefetch = () => {
    if (prefetched.current) return;
    prefetched.current = true;
    router.prefetch(href);
  };

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
