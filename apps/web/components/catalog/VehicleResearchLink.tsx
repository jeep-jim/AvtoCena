"use client";

import { useState, type MouseEvent } from "react";
import { BrowserResearchSheet } from "./BrowserResearchSheet";
import { vehicleResearchUrl, type VehicleResearchIdentity } from "../../lib/catalog/vehicle-research-link";

export function VehicleResearchLink({ identity, offerId }: { identity: VehicleResearchIdentity; offerId?: string }) {
  const [sheet, setSheet] = useState(false);
  const href = vehicleResearchUrl(identity);
  if (!href) return null;
  function openResearch(event: MouseEvent<HTMLAnchorElement>) {
    if (offerId && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); setSheet(true); return; }
  }
  return <>{sheet && offerId && <BrowserResearchSheet offerId={offerId} title={[identity.make, identity.model, identity.trim].filter(Boolean).join(" ")} fallback={href} onClose={() => setSheet(false)} />}<a href={href} onClick={openResearch} target="_blank" rel="noopener noreferrer" className="ac-vehicle-research-link flex min-h-12 w-full min-w-0 items-center justify-center gap-2.5 rounded-[1.1rem] px-3 py-3 text-center text-xs font-semibold leading-5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500" title="Уточнить характеристики автомобиля с Алисой. Проверьте источники перед вводом данных.">
    <img src="/brands/alice.svg" alt="Алиса" width={24} height={24} className="h-6 w-6 shrink-0" />
    <span>Уточнить характеристики с ИИ</span>
  </a></>;
}
