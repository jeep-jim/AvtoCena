export type CalculationItem = {
  id: string;
  title: string;
  amountRub: number;
};

export function calculateAvtocena(items: CalculationItem[]) {
  const totalRub = items.reduce((sum, item) => sum + item.amountRub, 0);
  return { items, totalRub };
}
