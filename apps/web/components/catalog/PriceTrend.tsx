import { money } from "@/lib/avtocena";

type PriceLike = {
  totalRub?: number | null;
  previousTotalRub?: number | null;
  priceDeltaRub?: number | null;
  priceChangedAt?: string;
};

export type PriceTrendDirection = "up" | "down";

export type PriceTrendValue = {
  direction: PriceTrendDirection;
  deltaRub: number;
  formattedDelta: string;
};

export function resolvePriceTrend(offer: PriceLike): PriceTrendValue | null {
  const current = Number(offer.totalRub || 0);
  const explicitDelta = Number(offer.priceDeltaRub || 0);
  const previous = Number(offer.previousTotalRub || 0);
  const delta = explicitDelta || (current && previous ? current - previous : 0);
  if (!current || !Number.isFinite(delta) || Math.abs(delta) < 1_000) return null;

  const absolute = Math.abs(delta);
  const formattedDelta = absolute >= 1_000_000
    ? `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(absolute / 1_000_000)}M`
    : `${Math.round(absolute / 1_000)}K`;

  return {
    direction: delta < 0 ? "down" : "up",
    deltaRub: delta,
    formattedDelta,
  };
}

function TrendArrow({ direction, className = "" }: { direction: PriceTrendDirection; className?: string }) {
  const down = direction === "down";
  return (
    <svg className={className} width="34" height="25" viewBox="0 0 34 25" fill="none" aria-hidden="true">
      <path
        d={down ? "M2.5 4.5L10 12L16 7L29.5 20.5" : "M2.5 20.5L10 13L16 18L29.5 4.5"}
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={down ? "M21.5 20.5H29.5V12.5" : "M21.5 4.5H29.5V12.5"}
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PriceTrend({
  offer,
  label = "Ориентир",
  priceClassName = "text-[22px]",
  className = "",
  panel = false,
}: {
  offer: PriceLike;
  label?: string;
  priceClassName?: string;
  className?: string;
  panel?: boolean;
}) {
  const trend = resolvePriceTrend(offer);
  const directionClass = trend?.direction === "down" ? "text-emerald-400" : "text-[#ff5c63]";
  const neutralClass = "text-red-500";
  const panelClass = trend?.direction === "down"
    ? "bg-emerald-500/[0.09]"
    : trend?.direction === "up"
      ? "bg-red-500/[0.085]"
      : "bg-red-500/[0.075]";

  return (
    <div className={`${panel ? `rounded-[1.35rem] p-4 ${panelClass}` : ""} ${className}`}>
      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-white/42">{label}</div>
      <div className="mt-1 flex min-w-0 items-end justify-between gap-3">
        <div className={`ac-price min-w-0 break-words font-black leading-none tracking-[-0.045em] ${priceClassName} ${trend ? directionClass : neutralClass}`}>
          {offer.totalRub ? `${money(offer.totalRub)} ₽` : "Цена уточняется"}
        </div>
        {trend ? (
          <div
            className={`flex shrink-0 items-center gap-1.5 pb-0.5 font-black ${directionClass}`}
            title="Изменение относительно предыдущего сохранённого расчёта"
            aria-label={`Цена ${trend.direction === "down" ? "снизилась" : "выросла"} на ${trend.formattedDelta}`}
          >
            <span className="text-xs md:text-sm">{trend.direction === "down" ? "−" : "+"}{trend.formattedDelta}</span>
            <TrendArrow direction={trend.direction} className="h-5 w-7 md:h-6 md:w-8" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
