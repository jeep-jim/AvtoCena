/** Original, listing-bound technical table. Display data is not pricing evidence. */
export type SourceSpecificationSnapshot = {
  version: 1;
  sourceId: string;
  sourceOfferId: string;
  specificationId: string;
  sourceUrl: string;
  capturedAt: string;
  groups: Array<{ name: string; items: Array<{ name: string; value: string }> }>;
};

// Only consume the source's named technical table, never arbitrary offer JSON
// (which can contain seller contacts, recommendations or promotional text).
export function retainNamedSpecificationGroups(input: unknown): SourceSpecificationSnapshot["groups"] {
  if (!Array.isArray(input)) return [];
  const scalar = (value: unknown): string | null =>
    typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value)
      : typeof value === "boolean" ? String(value) : null;
  return input.flatMap(group => {
    if (!group || typeof group !== "object" || typeof group.name !== "string" || !Array.isArray(group.paramitems)) return [];
    const items = group.paramitems.flatMap((item: any) => {
      if (!item || typeof item.name !== "string" || !item.name.trim()) return [];
      const value = scalar(item.value);
      // Empty and '-' remain explicit source omissions; zero/false are retained.
      return value === null ? [] : [{ name: item.name, value }];
    });
    return items.length ? [{ name: group.name, items }] : [];
  });
}
