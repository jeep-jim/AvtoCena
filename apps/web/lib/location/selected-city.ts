"use client";
import { useSyncExternalStore } from "react";

export const CITY_CHANGED_EVENT = "avtocena:city-changed";
export function readSelectedCity() {
 if (typeof window === "undefined") return "";
 try {
  const cookie = document.cookie.split(";").map(v=>v.trim()).find(v=>v.startsWith("avtocena_city="));
  if (cookie) return decodeURIComponent(cookie.slice("avtocena_city=".length)).trim();
  const stored=localStorage.getItem("avtocena_city");
  if(stored!==null)return stored.trim();
  return new URLSearchParams(window.location.search).get("city")?.trim() || "";
 } catch { return ""; }
}
function subscribe(notify:()=>void) {
 window.addEventListener(CITY_CHANGED_EVENT,notify);
 window.addEventListener("storage",notify);
 window.addEventListener("popstate",notify);
 return ()=>{window.removeEventListener(CITY_CHANGED_EVENT,notify);window.removeEventListener("storage",notify);window.removeEventListener("popstate",notify);};
}
export function useSelectedCity() { return useSyncExternalStore(subscribe,readSelectedCity,()=>""); }

export function persistCity(city: string) {
  try { localStorage.setItem("avtocena_city", city); } catch {}
  document.cookie = `avtocena_city=${encodeURIComponent(city)}; Max-Age=15552000; Path=/; SameSite=Lax`;
  const url = new URL(window.location.href);
  if (city) url.searchParams.set("city", city); else url.searchParams.delete("city");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new Event(CITY_CHANGED_EVENT));
}
