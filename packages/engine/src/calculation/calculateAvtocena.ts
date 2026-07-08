export type CalculationItem = {
  id: string;
  title: string;
  amountRub: number;
  kind?: "car" | "logistics" | "customs" | "service" | "commission" | "deposit";
};

export function calculateAvtocena(items: CalculationItem[]) {
  const totalRub = items.reduce((sum, item) => sum + item.amountRub, 0);
  const groups = items.reduce<Record<string, number>>((acc, item) => {
    const key = item.kind || "other";
    acc[key] = (acc[key] || 0) + item.amountRub;
    return acc;
  }, {});

  return { items, groups, totalRub };
}

export function rubFromCurrency(amount: number, rate: number) {
  return Math.round(amount * rate);
}
