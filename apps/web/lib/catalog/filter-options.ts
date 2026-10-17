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
  if (selected) allowed.add(clean(selected));
  const visible = options.slice(1).filter((option) => allowed.has(clean(option.value)));
  if (selected && !visible.some((option) => clean(option.value) === clean(selected))) {
    visible.push({ value: selected, label: clean(selected).replace(/\[object Object\]/gi, "") || "Без названия" });
  }
  return [options[0], ...visible];
}
