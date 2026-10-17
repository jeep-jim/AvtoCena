"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PartnerMobileDrawer } from "@/components/partner/PartnerMobileDrawer";

type NavUser = {
  role?: string;
} | null;

export function PartnerNavigation() {
  const [user, setUser] = useState<NavUser>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        const result = await response.json().catch(() => null);
        return result?.user ?? null;
      })
      .then((nextUser) => {
        if (!cancelled) setUser(nextUser);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  const cabinetHref = user ? "/partner" : "/login?next=/partner";
  const canSeeApi = user?.role === "owner" || user?.role === "admin";
  const showLogin = !user;

  return (
    <>
      <nav className="hidden flex-wrap gap-2 md:flex">
        <Link className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white/70 transition hover:bg-white/14" href="/partner/landing">
          Партнёрам
        </Link>
        <Link className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white/70 transition hover:bg-white/14" href={cabinetHref}>
          Кабинет
        </Link>
        {canSeeApi ? (
          <Link className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white/70 transition hover:bg-white/14" href="/partner/api">
            CPA API
          </Link>
        ) : null}
        {showLogin ? (
          <Link className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white/70 transition hover:bg-white/14" href="/login?next=/partner">
            Вход
          </Link>
        ) : null}
      </nav>

      <PartnerMobileDrawer
        cabinetHref={cabinetHref}
        canSeeApi={canSeeApi}
        showLogin={showLogin}
      />
    </>
  );
}
