type PriceLine = { id: string; title?: string; label?: string; amountRub: number; note?: string };

/** Adapt historical ledgers without changing their sum or stored snapshot. */
export function customerPriceBreakdown<T extends PriceLine>(lines: T[], configuredDepositRub?: number): T[] {
  const deposit = lines.filter(line => line.id === "security-deposit")
    .reduce((sum, line) => sum + Number(line.amountRub), 0);
  const car = lines.find(line => line.id === "car");
  const automaticAdjustments = lines.filter(line => line.id === "manual-adjustment" || line.id === "source-price-adjustment");
  const automaticAdjustmentRub = automaticAdjustments.reduce((sum, line) => sum + Number(line.amountRub || 0), 0);
  let result = lines;
  // Historical Che168 snapshots stored the automatic source correction as a
  // manager adjustment. It belongs to the displayed vehicle price and must
  // never appear to customers as a manual manager edit.
  if (car && automaticAdjustments.length && Number.isFinite(automaticAdjustmentRub)) {
    result = lines.filter(line => !automaticAdjustments.includes(line)).map(line => line === car
      ? {...line, amountRub: Math.max(0, Number(line.amountRub) + automaticAdjustmentRub)} : line);
  }
  // Legacy snapshots split an advance out of the car. Restore the full price once.
  // The configured advance is payment timing, never another expense or a discount.
  if (car && Number.isFinite(deposit) && deposit > 0) {
    const visibleCar = result.find(line => line.id === "car");
    const fullPrice = Number(visibleCar?.amountRub) + deposit;
    if (Number.isFinite(fullPrice) && fullPrice >= 0) {
      result = result.filter(line => line.id !== "security-deposit").map(line => line.id === "car"
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
