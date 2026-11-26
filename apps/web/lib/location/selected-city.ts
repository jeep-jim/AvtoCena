"use client";
import { useSyncExternalStore } from "react";
import { catalogRouteParams } from "../catalog/catalog-routes";

export const CITY_CHANGED_EVENT = "avtocena:city-changed";
function isJapanAuctionCatalog(pathname: string, query: URLSearchParams) {
 const path=pathname.replace(/\/$/,"");
 return query.get("stock")!=="green"&&(catalogRouteParams(path)?.market==="japan"||path==="/cars"&&query.get("market")==="japan");
}
/** An explicit Japan search carries the delivery city used by its server result. */
export function japanCatalogCity(pathname: string, search: string): string|null {
 const query=new URLSearchParams(search);
 if(!isJapanAuctionCatalog(pathname,query)||!query.has("city"))return null;
 const city=query.get("city")!.trim();
 return city.length>300||/[<>\u0000-\u001f\u007f]/.test(city)?null:city;
}
export function readSelectedCity() {
 if (typeof window === "undefined") return "";
 try {
  const query=new URLSearchParams(window.location.search);
  if(query.get('selection')==='1'&&query.has('city'))return query.get('city')!.trim();
  const japanCity=japanCatalogCity(window.location.pathname,window.location.search);
  if(japanCity!==null)return japanCity;
  const cookie = document.cookie.split(";").map(v=>v.trim()).find(v=>v.startsWith("avtocena_city="));
  if (cookie) return decodeURIComponent(cookie.slice("avtocena_city=".length)).trim();
  const stored=localStorage.getItem("avtocena_city");
  if(stored!==null)return stored.trim();
  return isJapanAuctionCatalog(window.location.pathname,query)?"":query.get("city")?.trim()||"";
 } catch { return ""; }
}
function subscribe(notify:()=>void) {
 window.addEventListener(CITY_CHANGED_EVENT,notify);
 window.addEventListener("storage",notify);
 window.addEventListener("popstate",notify);
 return ()=>{window.removeEventListener(CITY_CHANGED_EVENT,notify);window.removeEventListener("storage",notify);window.removeEventListener("popstate",notify);};
}
export function useSelectedCity(serverCity = "") { return useSyncExternalStore(subscribe,readSelectedCity,()=>serverCity); }

export function storeSelectedCity(city: string) {
  try { localStorage.setItem("avtocena_city", city); } catch {}
  document.cookie = `avtocena_city=${encodeURIComponent(city)}; Max-Age=15552000; Path=/; SameSite=Lax`;
}

/** Keep the explicit search city for the following vehicle detail visit too. */
export function adoptJapanCatalogCity() {
 if(typeof window==="undefined")return false;
 const city=japanCatalogCity(window.location.pathname,window.location.search);
 if(city===null)return false;
 storeSelectedCity(city);
 window.dispatchEvent(new Event(CITY_CHANGED_EVENT));
 return true;
}

/** A shared selection explicitly replaces the visitor’s previous delivery city. */
export function adoptSelectionCity(search: string) {
 const query=new URLSearchParams(search);
 const city=query.get("city")?.trim();
 if(query.get("selection")!=="1"||!city||city.length>300||/[<>\u0000-\u001f\u007f]/.test(city))return false;
 storeSelectedCity(city);
 window.dispatchEvent(new Event(CITY_CHANGED_EVENT));
 return true;
}

export function persistCity(city: string) {
  storeSelectedCity(city);
  const url = new URL(window.location.href);
  if (city) url.searchParams.set("city", city); else url.searchParams.delete("city");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new Event(CITY_CHANGED_EVENT));
}
