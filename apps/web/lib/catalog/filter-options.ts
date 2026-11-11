import {filterSelections} from './filter-selections';
export type CatalogFilterOption = { value: string; label: string };

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function catalogFilterOptions(
  options: CatalogFilterOption[],
  availableValues: string[] = [],
  selected = "",
) {
  const allowed = new Set(availableValues.map(clean));
  for(const value of filterSelections(selected))allowed.add(clean(value));
  const visible = options.slice(1).filter((option) => allowed.has(clean(option.value)));
  for(const value of filterSelections(selected))if(!visible.some(option=>clean(option.value)===clean(value)))visible.push({value,label:clean(value).replace(/\[object Object\]/gi, "")||"Без названия"});
  return [options[0], ...visible];
}
