import {filterSelections} from './filter-selections';
/** Combined selection is a query value, never a vehicle fuel type. */
export function matchesFuelFilter(actual: unknown, selected: string | undefined) {
 if (!selected) return true;
 const fuel = String(actual || "").toLowerCase();
 return filterSelections(selected).some(value=>value === "electrified" ? ["electric", "hybrid"].includes(fuel) : fuel === value.toLowerCase());
}
export const isElectrifiedFilter = (value: string) => filterSelections(value).length>0&&filterSelections(value).every(item=>["electric", "hybrid", "electrified"].includes(item));
