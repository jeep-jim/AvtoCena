import { PriceTrend } from "@/components/catalog/PriceTrend";

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

  if (totalRub > 0) {
    const preliminary = String(offer?.calculationStatus || "") === "preliminary_power_pending"
      || offer?.calculationSnapshot?.pricingConfidence === "preliminary";
    return <PriceTrend offer={offer} label={preliminary ? "Предварительно от" : label} dense={dense} priceClassName={priceClassName} />;
  }

  return (
    <div className="ac-price-trend relative min-w-0">
      <div className={`${dense ? "text-[8px] sm:text-[10px]" : "text-[10px]"} ac-price-trend-label min-w-0 font-black uppercase tracking-[0.19em] text-[var(--ac-text)]`}>
        {label}
      </div>
      <div className={`${dense ? "mt-1 sm:mt-1.5" : "mt-1.5"} flex min-w-0 items-end justify-between`}>
        <div className={`ac-price ac-price--flat min-w-0 whitespace-nowrap font-black leading-none tracking-[-0.05em] ${priceClassName}`}>
          Цена по запросу
        </div>
      </div>
    </div>
  );
}
