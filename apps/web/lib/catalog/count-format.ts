/** Stable SSR/browser count text. NBSP groups thousands without splitting the number. */
export function formatCatalogCount(count: number): string {
  if (!Number.isSafeInteger(count) || count < 0) return "—";
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
}
