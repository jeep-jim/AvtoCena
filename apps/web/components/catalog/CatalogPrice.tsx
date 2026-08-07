import { PriceTrend } from "@/components/catalog/PriceTrend";

function money(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(value));
}

export function CatalogPrice({
  offer,
  label,
  dense = false,
  priceClassName = "text-[22px]",
}: {
  offer: any;
  label: string;
  dense?: boolean;
  priceClassName?: string;
}) {
  const totalRub = Number(offer?.totalRub || 0);
  const sourcePrice = Number(offer?.sourcePrice || 0);
  const sourceCurrency = String(offer?.sourceCurrency || "").trim().toUpperCase();

  if (totalRub > 0) {
    return <PriceTrend offer={offer} label={label} dense={dense} priceClassName={priceClassName} />;
  }

  if (sourcePrice > 0 && sourceCurrency) {
    return (
      <div className="ac-price-trend relative min-w-0">
        <div className={`${dense ? "text-[8px] sm:text-[10px]" : "text-[10px]"} ac-price-trend-label min-w-0 font-black uppercase tracking-[0.19em] text-[var(--ac-text)]`}>
          {label}
        </div>
        <div className={`${dense ? "mt-1 sm:mt-1.5" : "mt-1.5"} flex min-w-0 items-end justify-between`}>
          <div className={`ac-price ac-price--flat min-w-0 whitespace-nowrap font-black leading-none tracking-[-0.05em] ${priceClassName}`}>
            <span>{money(sourcePrice)}</span>
            <span className="ml-[0.28em] inline-block translate-y-[-0.03em] text-[0.46em] tracking-[0.02em]">{sourceCurrency}</span>
          </div>
        </div>
      </div>
    );
  }

  return <PriceTrend offer={offer} label={label} dense={dense} priceClassName={priceClassName} />;
}
