type PriceLine = { id: string; title?: string; label?: string; amountRub: number; note?: string };

/** The stored engine splits car payment into balance + deposit. Public cost
 * breakdowns show the seller's full car price; a deposit is not another cost.
 * Merge the existing amounts rather than applying today's business settings.
 * This also works for historical snapshots without repricing their totals. */
export function customerPriceBreakdown<T extends PriceLine>(lines: T[]): T[] {
  const deposit = lines.filter(line => line.id === "security-deposit")
    .reduce((sum, line) => sum + Number(line.amountRub), 0);
  if (!Number.isFinite(deposit) || deposit <= 0) return lines;
  const car = lines.find(line => line.id === "car");
  const fullPrice = Number(car?.amountRub || 0) + deposit;
  if (!Number.isFinite(fullPrice) || fullPrice < deposit) return lines;
  const carLine = {
    ...(car || lines.find(line => line.id === "security-deposit")!),
    id: "car", title: "Цена автомобиля", label: "Цена автомобиля", amountRub: fullPrice,
    note: `В том числе обеспечительный платёж ${deposit.toLocaleString("ru-RU")} ₽ — входит в цену, не добавляется сверху.`,
  } as T;
  // If the deposit covered the whole car, the engine omitted its zero balance.
  if (!car) return [carLine, ...lines.filter(line => line.id !== "security-deposit")];
  return lines.filter(line => line.id !== "security-deposit").map(line => line === car ? carLine : line);
}
