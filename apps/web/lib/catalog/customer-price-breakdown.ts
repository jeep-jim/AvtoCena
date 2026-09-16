type PriceLine = { id: string; title?: string; label?: string; amountRub: number; note?: string };

/** Adapt historical ledgers without changing their sum or stored snapshot. */
export function customerPriceBreakdown<T extends PriceLine>(lines: T[]): T[] {
  const deposit = lines.filter(line => line.id === "security-deposit")
    .reduce((sum, line) => sum + Number(line.amountRub), 0);
  const car = lines.find(line => line.id === "car");
  let result = lines;
  if (Number.isFinite(deposit) && deposit > 0) {
    const fullPrice = Number(car?.amountRub || 0) + deposit;
    if (Number.isFinite(fullPrice) && fullPrice >= deposit) {
      const carLine = {...(car || lines.find(line => line.id === "security-deposit")!),
        id: "car", title: "Цена автомобиля", label: "Цена автомобиля", amountRub: fullPrice, note: undefined} as T;
      result = car ? lines.filter(line => line.id !== "security-deposit").map(line => line === car ? carLine : line)
        : [carLine, ...lines.filter(line => line.id !== "security-deposit")];
    }
  }
  const bundleIds = ["laboratory", "sbkts", "epts"];
  const first = result.find(line => bundleIds.includes(line.id));
  const amountRub = result.filter(line => bundleIds.includes(line.id)).reduce((sum, line) => sum + Number(line.amountRub), 0);
  return result.filter(line => !bundleIds.includes(line.id) || line === first).map(line => {
    if (line === first) return {...line, id: "laboratory", title: "Лаборатория, СБКТС, ЭПТС", label: "Лаборатория, СБКТС, ЭПТС", amountRub, note: undefined};
    if (line.id === "car" && line.note) return {...line, note: undefined};
    return line;
  });
}
