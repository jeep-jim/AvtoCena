"use client";
import {useState} from "react";
export function ShareLinkButton({className = ""}: {className?: string}) {
  const [status,setStatus]=useState("");
  async function share() {
    const url = window.location.origin + window.location.pathname;
    if(navigator.share) {try {await navigator.share({title:document.title,url});setStatus("");return;} catch(error) {if((error as Error).name === "AbortError") return;}}
    try {await navigator.clipboard.writeText(url);setStatus("Ссылка скопирована");}
    catch {setStatus("Скопируйте адрес из строки браузера");}
  }
  return <button type="button" onClick={share} className={className}><svg className="mr-2 shrink-0" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12v8h16v-8M12 16V3m-5 5 5-5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg><span aria-live="polite">{status || "Поделиться ссылкой"}</span></button>;
}
