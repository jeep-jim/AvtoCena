export function SellerPrice({ sellerPriceRub, sourceLabel, label = "Цена продавца" }: { sellerPriceRub: number; sourceLabel?: string; label?: string }) {
  if (!Number.isFinite(sellerPriceRub) || sellerPriceRub <= 0) return null;
  return <div className="min-w-0 border-b border-[var(--ac-border)] pb-5 text-[var(--ac-text)]">
    <p className="text-xs font-bold text-[var(--ac-muted)]">{label}</p>
    <p className="mt-1 text-4xl font-black tracking-tight">{Math.round(sellerPriceRub).toLocaleString("ru-RU")}<span className="ml-1 text-2xl">₽</span></p>
    <p className="mt-2 text-xs leading-5 text-[var(--ac-muted)]">Доставка и платежи не включены.{sourceLabel ? <span className="block">{sourceLabel}</span> : null}</p>
  </div>;
}
