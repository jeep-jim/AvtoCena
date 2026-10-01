import type {ReactNode} from "react";

export type SpecIconName = "year" | "mileage" | "engine" | "fuel" | "power" | "transmission" | "drive" | "body" | "electricMotor" | "thirtyMinute";

export type SpecItem = { label: string; value: string; icon: SpecIconName; info?: string };

function SpecIcon({ name }: { name: SpecIconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const paths: Record<SpecIconName, ReactNode> = {
    year: <><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M7.5 3.5v3M16.5 3.5v3M3.5 9h17" /><path d="M8 13h3M13.5 13H16M8 16.5h3M13.5 16.5H16" /></>,
    mileage: <><path d="M4 17.5a8.5 8.5 0 1 1 16 0" /><path d="m12 12 4.5-3" /><circle cx="12" cy="12" r="1.3" /><path d="M7 18h10" /></>,
    engine: <><path d="M5 8.5h11.5l2 2v6.5H7l-2-2z" /><path d="M8 8.5V6h5v2.5M19 11h2v4h-2M5 11H3v3h2M9 12h4" /></>,
    fuel: <><path d="M6 20V5.5A1.5 1.5 0 0 1 7.5 4h6A1.5 1.5 0 0 1 15 5.5V20" /><path d="M4 20h13M8 7h5v4H8zM15 8h2l2 2v6.5a1.5 1.5 0 0 0 3 0V9l-2-2" /></>,
    power: <path d="M13.5 2.8 5.8 13h5.1l-.7 8.2L18.3 11h-5.1z" />,
    transmission: <><circle cx="7" cy="5" r="2" /><circle cx="17" cy="5" r="2" /><circle cx="7" cy="19" r="2" /><circle cx="17" cy="19" r="2" /><path d="M7 7v10M17 7v10M7 12h10" /></>,
    drive: <><path d="M8.2 6.5h7.6M12 6.5v11M8.2 17.5h7.6" /><rect x="4.2" y="2.5" width="4" height="7" rx="1.2" transform="rotate(27 6.2 6)" /><rect x="15.8" y="2.5" width="4" height="7" rx="1.2" transform="rotate(27 17.8 6)" /><rect x="4.2" y="14" width="4" height="7" rx="1.2" /><rect x="15.8" y="14" width="4" height="7" rx="1.2" /></>,
    body: <><circle cx="7" cy="17" r="2.5" /><circle cx="17" cy="17" r="2.5" /><path d="M4.5 17H3v-4l2-1 2.5-5h8.5l3 5 2 1v4h-1.5M9.5 17h5" /><path d="M8 9h7" /></>,
    electricMotor: <><rect x="3.5" y="6" width="15" height="12" rx="3" /><path d="M18.5 10h2v4h-2M7.5 10h6M7.5 14h4" /><path d="m13 8.6-3.3 4.2h2.2l-.6 3 3.8-4.8h-2.2z" fill="currentColor" stroke="none" /></>,
    thirtyMinute: <><rect x="3.5" y="6" width="12" height="12" rx="2.5" /><path d="M15.5 10h2v4h-2M7.5 9.5h4M7.5 14.5h4" /><circle cx="18" cy="18" r="4" fill="var(--ac-surface, #11141c)" /><path d="M18 15.8V18l1.4 1" /></>,
  };
  return <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-[var(--ac-text)] opacity-50" aria-hidden="true" {...common}>{paths[name]}</svg>;
}

export function SpecTile({ label, value, icon, info, fullWidth = false }: SpecItem & { fullWidth?: boolean }) {
  return <div aria-label={`${label}: ${value}`} className="ac-offer-spec-tile relative flex min-w-0 items-center gap-3 rounded-2xl px-3.5 py-3.5" style={fullWidth ? { gridColumn: "1 / -1" } : undefined}>
    <SpecIcon name={icon} />
    <span className="min-w-0 flex-1 break-words text-[13px] font-semibold leading-[1.28] text-[var(--ac-text)] md:text-sm">{value}</span>
    {info ? <details className="group static z-30 ml-auto shrink-0">
      <summary className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-full border border-white/12 bg-white/10 text-xs font-black text-[var(--ac-text)] shadow-[inset_0_1px_0_rgba(255,255,255,.12)] backdrop-blur-md transition hover:bg-white/15 [&::-webkit-details-marker]:hidden" aria-label={`Что означает ${label}`}>?</summary>
      <div className="ac-spec-info-popover absolute right-0 top-[calc(100%+.5rem)] z-50 w-[min(290px,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-[var(--ac-surface)] p-4 text-left text-xs font-semibold leading-5 text-[var(--ac-muted)] shadow-2xl">{info}</div>
    </details> : null}
  </div>;
}

