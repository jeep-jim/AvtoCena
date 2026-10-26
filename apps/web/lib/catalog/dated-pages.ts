/** Exact policy-day derivatives; never rewrite a generation pointer. */
export function datedCatalogPagePath(path:string, day:string) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!path.endsWith('.json'))throw Error('catalog_page_date_invalid');
  return `${path.slice(0,-5)}.${day}.json`;
}
