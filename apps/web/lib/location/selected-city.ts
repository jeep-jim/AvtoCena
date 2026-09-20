"use client";
import { useSyncExternalStore } from "react";

export const CITY_CHANGED_EVENT = "avtocena:city-changed";
export function readSelectedCity() {
 if (typeof window === "undefined") return "";
 const query = new URLSearchParams(window.location.search).get("city");
 if (query !== null) return query.trim();
 try {
  const cookie = document.cookie.split(";").map(v=>v.trim()).find(v=>v.startsWith("avtocena_city="));
  if (cookie) return decodeURIComponent(cookie.slice("avtocena_city=".length)).trim();
  return localStorage.getItem("avtocena_city") || "";
 } catch { return ""; }
}
function subscribe(notify:()=>void) {
 window.addEventListener(CITY_CHANGED_EVENT,notify);
 window.addEventListener("storage",notify);
 window.addEventListener("popstate",notify);
 return ()=>{window.removeEventListener(CITY_CHANGED_EVENT,notify);window.removeEventListener("storage",notify);window.removeEventListener("popstate",notify);};
}
export function useSelectedCity() { return useSyncExternalStore(subscribe,readSelectedCity,()=>""); }
