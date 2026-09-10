"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { BrowserResearchSheet } from "./BrowserResearchSheet";
import { vehicleResearchUrl, type VehicleResearchIdentity } from "../../lib/catalog/vehicle-research-link";

export function VehicleResearchLink({ identity, offerId }: { identity: VehicleResearchIdentity; offerId?: string }) {
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 767px)");
    const resize = () => { if (!mobile.matches) setSheet(false); };
    mobile.addEventListener("change", resize);
    return () => mobile.removeEventListener("change", resize);
  }, []);
  const href = vehicleResearchUrl(identity);
  if (!href) return null;
  function openResearch(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (window.matchMedia("(max-width: 767px)").matches) {
      if (offerId) { event.preventDefault(); setSheet(true); }
      return;
    }
    // Desktop keeps the previous separate research window; no cloud session.
    const width = Math.min(680, Math.max(420, Math.round(window.outerWidth * .36)));
    const popup = window.open("about:blank", "_blank",
      `popup=yes,width=${width},height=${Math.max(480, window.outerHeight)},left=${window.screenX + window.outerWidth - width},top=${window.screenY}`);
    if (!popup) return;
    popup.opener = null;
    popup.location.replace(href!);
    event.preventDefault();
  }
  return <>{sheet && offerId && <BrowserResearchSheet offerId={offerId} title={[identity.make, identity.model, identity.trim].filter(Boolean).join(" ")} fallback={href} onClose={() => setSheet(false)} />}<a href={href} onClick={openResearch} target="_blank" rel="noopener noreferrer" className="ac-vehicle-research-link flex min-h-12 w-full min-w-0 items-center justify-center gap-2.5 rounded-[1.1rem] px-3 py-3 text-center text-xs font-semibold leading-5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500" title="Уточнить характеристики автомобиля с Алисой. Проверьте источники перед вводом данных.">
    <img src="/brands/alice.svg" alt="Алиса" width={24} height={24} className="h-6 w-6 shrink-0" />
    <span>Уточнить характеристики с ИИ</span>
  </a></>;
}
