"use client";
import {useState} from "react";
export function ShareLinkButton({className = ""}: {className?: string}) {
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
  return <button type="button" onClick={share} className={`relative min-w-0 ${className}`}><svg className="pointer-events-none absolute left-4 hidden shrink-0 md:block xl:left-5" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12v8h16v-8M12 16V3m-5 5 5-5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg><span className={`min-w-0 text-center text-[11px] min-[375px]:text-xs sm:text-sm md:text-base ${status ? "" : "whitespace-nowrap"}`} aria-live="polite">{status || "Поделиться ссылкой"}</span></button>;
}
