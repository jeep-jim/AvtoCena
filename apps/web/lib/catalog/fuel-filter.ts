/** Combined selection is a query value, never a vehicle fuel type. */
export function matchesFuelFilter(actual: unknown, selected: string | undefined) {
 if (!selected) return true;
 const fuel = String(actual || "").toLowerCase();
 return selected === "electrified" ? ["electric", "hybrid"].includes(fuel) : fuel === selected.toLowerCase();
}
export const isElectrifiedFilter = (value: string) => ["electric", "hybrid", "electrified"].includes(value);
