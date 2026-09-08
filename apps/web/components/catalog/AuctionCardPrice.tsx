import { JapanAuctionBadges } from "./JapanAuctionBadges";
import type { JapanExportRestriction } from "../../lib/catalog/japan-export-restriction";

type AuctionCardPriceProps = {
  offer: { totalRub?: number | null; auctionGrade?: unknown; japanExportRestriction?: JapanExportRestriction };
  label: string;
  dense?: boolean;
  priceClassName?: string;
};

export function AuctionCardPrice({ offer, label, dense = false, priceClassName = "text-[22px]" }: AuctionCardPriceProps) {
  const totalRub = Number(offer?.totalRub || 0);
  return <div className="ac-auction-card-price relative min-w-0">
    <div className={`${dense ? "text-[8px] sm:text-[10px]" : "text-[10px]"} ac-price-trend-label min-w-0 font-black uppercase tracking-[0.19em] text-[var(--ac-text)]`}>{label}</div>
    <div className={`${dense ? "mt-1 gap-1 sm:mt-1.5 sm:gap-3" : "mt-1.5 gap-3"} flex min-w-0 flex-wrap items-end justify-between`}>
      <div className={`ac-price ac-price--flat min-w-0 font-black leading-none tracking-[-0.05em] text-[var(--ac-text)] ${totalRub ? "whitespace-nowrap" : "break-words"} ${priceClassName}`}>
        {totalRub ? <><span>{new Intl.NumberFormat("ru-RU").format(Math.round(totalRub))}</span><span className="ml-[0.18em] inline-block translate-y-[-0.03em] text-[0.58em] tracking-[-0.02em]">₽</span></> : "Цена по запросу"}
      </div>
      <JapanAuctionBadges offer={offer} dense={dense} />
    </div>
  </div>;
}
