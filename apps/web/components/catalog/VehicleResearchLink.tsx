"use client";

import { type MouseEvent } from "react";
import { vehicleResearchUrl, type VehicleResearchIdentity } from "../../lib/catalog/vehicle-research-link";

export function VehicleResearchLink({ identity }: { identity: VehicleResearchIdentity; offerId?: string }) {
  const href = vehicleResearchUrl(identity);
  return href ? <ResearchLink href={href} label="Уточнить характеристики с ИИ" /> : null;
}

export function ResearchLink({href: providedHref, query, label, compact=false}: {href?:string;query?:string;label:string;compact?:boolean}) {
  const href = providedHref || `https://yandex.ru/search/?text=${encodeURIComponent(query || "")}`;
  function openResearch(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
      || !window.matchMedia("(min-width: 1024px) and (pointer: fine)").matches) return;
    // Open a blank window synchronously so popup blocking can fall back to the
    // ordinary link. Sever opener BEFORE navigating to the external origin.
    const width = Math.min(680, Math.max(420, Math.round(window.outerWidth * .36)));
    const height = Math.max(480, window.outerHeight);
    const popup = window.open("about:blank", "_blank",
      `popup=yes,width=${width},height=${height},left=${window.screenX + window.outerWidth - width},top=${window.screenY}`);
    if (!popup) return;
    popup.opener = null;
    popup.location.replace(href!);
    event.preventDefault();
  }
  return <><a href={href} onClick={openResearch} target="_blank" rel="noopener noreferrer" className={`ac-vehicle-research-link ${compact ? "ac-research-compact" : ""} flex min-h-12 w-full min-w-0 items-center gap-2.5 rounded-[1.1rem] px-3 py-3 text-xs font-semibold leading-5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${compact ? "justify-start text-left" : "justify-center text-center"}`} title="Поиск в Яндексе в отдельном окне. Проверьте модификацию и источник перед вводом данных.">
    <img src="/brands/alice.svg" alt="Алиса" width={24} height={24} className="h-6 w-6 shrink-0" />
    <span>{label}</span>
  </a></>;
}
