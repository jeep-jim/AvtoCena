type PriceLine = { id: string; title?: string; label?: string; amountRub: number; note?: string };

/** Adapt historical ledgers without changing their sum or stored snapshot. */
export function customerPriceBreakdown<T extends PriceLine>(lines: T[], configuredDepositRub?: number): T[] {
  const deposit = lines.filter(line => line.id === "security-deposit")
    .reduce((sum, line) => sum + Number(line.amountRub), 0);
  const car = lines.find(line => line.id === "car");
  let result = lines;
  const requestedDeposit = Number(configuredDepositRub ?? deposit);
  if (Number.isFinite(deposit) && deposit >= 0 && Number.isFinite(requestedDeposit) && requestedDeposit >= 0 && (requestedDeposit > 0 || deposit > 0) && (car || deposit > 0)) {
    const fullPrice = Number(car?.amountRub || 0) + deposit;
    if (Number.isFinite(fullPrice) && fullPrice >= 0) {
      const depositRub = Math.min(fullPrice, requestedDeposit);
      const carLine = {...(car || lines.find(line => line.id === "security-deposit")!),
        id: "car", title: "Цена автомобиля", label: "Цена автомобиля", amountRub: fullPrice - depositRub, note: undefined} as T;
      const depositLine = {...carLine, id: "security-deposit", title: "Обеспечительный платёж",
        label: "Обеспечительный платёж", amountRub: depositRub, kind: "deposit", amountType: "fixed", source: "market_config"} as T;
      const pair = depositRub > 0 ? [carLine, depositLine] : [carLine];
      result = car ? lines.filter(line => line.id !== "security-deposit").flatMap(line => line === car ? pair : [line])
        : [...pair, ...lines.filter(line => line.id !== "security-deposit")];
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
