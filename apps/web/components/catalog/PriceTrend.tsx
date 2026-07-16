type PriceLike = {
  totalRub?: number | null;
  previousTotalRub?: number | null;
  priceDeltaRub?: number | null;
  priceChangedAt?: string;
  sourcePrice?: number | null;
  calculationSnapshot?: {
    currencyRate?: {
      effectiveRate?: number;
      previousEffectiveRate?: number;
      rateDelta?: number;
      rateDate?: string;
      previousRateDate?: string;
    };
  } | null;
};

export type PriceTrendDirection = "up" | "down";

export type PriceTrendValue = {
  direction: PriceTrendDirection;
  deltaRub: number;
  formattedDelta: string;
};

function money(value: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(value));
}

function savedPriceDelta(offer: PriceLike) {
  const current = Number(offer.totalRub || 0);
  const explicitDelta = Number(offer.priceDeltaRub || 0);
  const previous = Number(offer.previousTotalRub || 0);
  return explicitDelta || (current && previous ? current - previous : 0);
}

function currencyDelta(offer: PriceLike) {
  const sourcePrice = Number(offer.sourcePrice || 0);
  const rate = offer.calculationSnapshot?.currencyRate;
  const effectiveRate = Number(rate?.effectiveRate || 0);
  const previousEffectiveRate = Number(rate?.previousEffectiveRate || 0);
  const explicitRateDelta = Number(rate?.rateDelta || 0);
  const rateDelta = explicitRateDelta || (effectiveRate && previousEffectiveRate ? effectiveRate - previousEffectiveRate : 0);
  if (!sourcePrice || !Number.isFinite(rateDelta)) return 0;
  return Math.round(sourcePrice * rateDelta);
}

export function resolvePriceTrend(offer: PriceLike): PriceTrendValue | null {
  const current = Number(offer.totalRub || 0);
  const delta = savedPriceDelta(offer) || currencyDelta(offer);
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
  dense = false,
}: {
  offer: PriceLike;
  label?: string;
  priceClassName?: string;
  className?: string;
  panel?: boolean;
  dense?: boolean;
}) {
  const trend = resolvePriceTrend(offer);
  const directionClass = trend?.direction === "down" ? "text-[#168a59]" : "text-[#ff5c63]";
  const priceClass = trend?.direction === "down" ? "text-[#168a59]" : "text-red-500";
  const panelClass = trend?.direction === "down"
    ? "bg-[#168a59]/[0.09]"
    : trend?.direction === "up"
      ? "bg-red-500/[0.085]"
      : "bg-red-500/[0.075]";
  const hasPrice = Boolean(offer.totalRub);
  const trendUsesCurrency = Boolean(trend) && !savedPriceDelta(offer) && Boolean(currencyDelta(offer));
  const trendTitle = trendUsesCurrency
    ? "Изменение расчёта из-за обновления валютного курса"
    : "Изменение относительно предыдущего сохранённого расчёта";

  return (
    <div className={`${panel ? `rounded-[1.35rem] p-4 ${panelClass}` : ""} ${className}`}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className={`${dense ? "text-[8px] sm:text-[10px]" : panel ? "text-[10px] md:text-[11px]" : "text-[10px]"} min-w-0 font-black uppercase tracking-[0.19em] text-white/42`}>{label}</div>
        {trend ? (
          <span
            className={`${dense ? "text-[9px] sm:text-xs" : "text-xs md:text-sm"} shrink-0 font-black leading-none ${directionClass}`}
            title={trendTitle}
            aria-label={`Цена ${trend.direction === "down" ? "снизилась" : "выросла"} на ${trend.formattedDelta}`}
          >
            {trend.direction === "down" ? "−" : "+"}{trend.formattedDelta}
          </span>
        ) : null}
      </div>
      <div className={`${dense ? "mt-1 gap-1 sm:mt-1.5 sm:gap-3" : "mt-1.5 gap-3"} flex min-w-0 items-end justify-between`}>
        <div className={`ac-price min-w-0 font-black leading-none tracking-[-0.05em] ${hasPrice ? "whitespace-nowrap" : "break-words"} ${priceClassName} ${priceClass}`}>
          {hasPrice ? (
            <>
              <span>{money(Number(offer.totalRub))}</span>
              <span className="ml-[0.18em] inline-block translate-y-[-0.03em] text-[0.58em] tracking-[-0.02em]">₽</span>
            </>
          ) : (
            "Цена уточняется"
          )}
        </div>
        {trend ? (
          <div className={`flex shrink-0 items-center pb-0.5 ${directionClass}`} title={trendTitle} aria-hidden="true">
            <TrendArrow direction={trend.direction} className={dense ? "h-4 w-5 sm:h-5 sm:w-7 md:h-6 md:w-8" : "h-5 w-7 md:h-6 md:w-8"} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
