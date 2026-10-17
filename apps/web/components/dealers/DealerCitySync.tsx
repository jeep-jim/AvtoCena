"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { CITY_CHANGED_EVENT } from "@/lib/location/selected-city";
/** Re-read server quotes after the shared city picker updates its cookie. */
export function DealerCitySync() {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => router.refresh();
    window.addEventListener(CITY_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(CITY_CHANGED_EVENT, refresh);
  }, [router]);
  return null;
}
