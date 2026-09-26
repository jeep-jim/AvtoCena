"use client";
import {useState} from "react";
export function ShareLinkButton({className = "", compactMobile = false, iconOnly = false}: {className?: string; compactMobile?: boolean; iconOnly?: boolean}) {
  const [status,setStatus]=useState("");
  async function share() {
    const target = new URL(window.location.pathname, window.location.origin);
    const savedVersion=document.querySelector<HTMLElement>("[data-offer-saved-version]")?.dataset.offerSavedVersion;
    if(savedVersion)target.searchParams.set("calculation",savedVersion);
    const url=target.toString();
    if(navigator.share) {try {await navigator.share({title:document.title,url});setStatus("");return;} catch(error) {if((error as Error).name === "AbortError") return;}}
    try {await navigator.clipboard.writeText(url);setStatus("Ссылка скопирована");}
    catch {setStatus("Скопируйте адрес из строки браузера");}
  }
  if(iconOnly) return <button type="button" onClick={share} className={className} aria-label="Поделиться автомобилем" title={status || "Поделиться автомобилем"}><svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12v8h16v-8M12 16V3m-5 5 5-5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg><span className="sr-only" aria-live="polite">{status}</span></button>;
  return <button type="button" onClick={share} className={`relative min-w-0 ${className}`}><svg className={`pointer-events-none absolute left-4 shrink-0 xl:left-5 ${compactMobile ? "hidden md:block" : "block"}`} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12v8h16v-8M12 16V3m-5 5 5-5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg><span className={`min-w-0 text-center text-[13px] sm:text-sm md:text-base ${status ? "" : "whitespace-nowrap"}`} aria-live="polite">{status || (compactMobile ? <><span className="md:hidden">Поделиться</span><span className="hidden md:inline">Поделиться ссылкой</span></> : "Поделиться ссылкой")}</span></button>;
}
