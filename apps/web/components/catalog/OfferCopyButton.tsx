"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatOfferCopy } from "../../lib/offer-copy";

export function OfferCopyButton({offerId,title,mileageKm,draft,pending}:{offerId:string;title:string;mileageKm?:number | null;draft:Record<string,string>;pending:boolean}) {
  const [hosts,setHosts] = useState<HTMLElement[]>([]);
  const [message,setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const page = anchor.current?.closest("[data-offer-id]");
    const targets = Array.from(page?.querySelectorAll<HTMLElement>("[data-offer-copy-slot]") || []);
    setHosts(targets);
    targets.forEach(t => t.parentElement?.setAttribute("data-has-copy","true"));
    return () => { targets.forEach(t => t.parentElement?.removeAttribute("data-has-copy")); clearTimeout(timer.current); };
  }, [offerId]);
  async function copy() {
    try {
      // Read the currently rendered price, including live saved-calculation
      // updates. Never copy the initial catalog amount after a recalculation.
      const price = anchor.current?.closest(".ac-inline-parameters")?.querySelector(".ac-offer-price-panel .ac-price")?.textContent || "";
      const totalRub = price.includes("₽") ? Number(price.replace(/[^\d,.-]/g,"").replace(",",".")) : null;
      const text = formatOfferCopy({title,mileageKm,year:draft.year,engineCc:draft.engineCc,powerHp:draft.powerHp,totalRub});
      if (!navigator.clipboard?.writeText) throw new Error("Браузер не разрешает копирование. Откройте карточку в браузере и повторите.");
      await navigator.clipboard.writeText(text);
      setMessage("Скопировано");
    } catch (error) {
      setMessage(error instanceof Error && error.message.startsWith("Дождитесь") ? error.message : "Не удалось скопировать. Разрешите доступ к буферу обмена в браузере.");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(""), 4000);
  }
  return <><span ref={anchor} hidden />{hosts.map((host,i) => createPortal(<div className="relative">
    <button type="button" disabled={pending} aria-label="Скопировать данные автомобиля" title={pending ? "Дождитесь пересчёта" : "Скопировать данные автомобиля"} onClick={copy} className="ac-offer-copy inline-flex h-14 w-14 items-center justify-center rounded-[1.05rem] bg-[#7C3AED] text-2xl transition-[filter,transform] hover:brightness-110 active:scale-[.97] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400"><span aria-hidden="true" style={{fontFamily:"'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif"}}>🌼</span></button>
    {message ? <span role="status" className="absolute bottom-full right-0 z-50 mb-2 w-max max-w-[240px] rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface)] px-3 py-2 text-xs font-semibold text-[var(--ac-text)] shadow-lg">{message}</span> : null}
  </div>,host,String(i)))}</>;
}
