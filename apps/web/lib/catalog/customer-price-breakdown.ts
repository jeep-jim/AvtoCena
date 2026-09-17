type PriceLine = { id: string; title?: string; label?: string; amountRub: number; note?: string };

/** Adapt historical ledgers without changing their sum or stored snapshot. */
export function customerPriceBreakdown<T extends PriceLine>(lines: T[], configuredDepositRub?: number): T[] {
  const deposit = lines.filter(line => line.id === "security-deposit")
    .reduce((sum, line) => sum + Number(line.amountRub), 0);
  const car = lines.find(line => line.id === "car");
  let result = lines;
  // Legacy snapshots split an advance out of the car. Restore the full price once.
  // The configured advance is payment timing, never another expense or a discount.
  if (car && Number.isFinite(deposit) && deposit > 0) {
    const fullPrice = Number(car.amountRub) + deposit;
    if (Number.isFinite(fullPrice) && fullPrice >= 0) {
      result = lines.filter(line => line.id !== "security-deposit").map(line => line === car
        ? {...line, title: "Цена автомобиля", amountRub: fullPrice, note: undefined} : line);
    }
  }
  const bundleIds = ["laboratory", "sbkts", "epts"];
  const first = result.find(line => bundleIds.includes(line.id));
  const amountRub = result.filter(line => bundleIds.includes(line.id)).reduce((sum, line) => sum + Number(line.amountRub), 0);
  return result.filter(line => !bundleIds.includes(line.id) || line === first).map(line => {
    if (line === first) return {...line, id: "laboratory", title: "Лаборатория, СБКТС, ЭПТС", label: "Лаборатория, СБКТС, ЭПТС", amountRub, note: undefined};
    if (line.id === "car" && "note" in line) { const {note, ...rest} = line; return rest as T; }
    return line;
  });
}
