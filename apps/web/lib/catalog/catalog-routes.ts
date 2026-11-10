/** Public URL presentation only: this module never changes search/calculation inputs. */
export const CATALOG_COUNTRIES: Record<string, string> = {
 china: 'Китая', japan: 'Японии', korea: 'Кореи', uae: 'ОАЭ', europe: 'Европы', georgia: 'Грузии',
};
export type CatalogRouteParams = {market: string; make?: string; model?: string};
export function catalogRouteParams(pathname: string): CatalogRouteParams | null {
 const parts = pathname.replace(/\/$/, '').split('/');
 if (parts[1] !== 'cars' || parts.length < 3 || parts.length > 5 || !Object.hasOwn(CATALOG_COUNTRIES, parts[2])) return null;
 try {
  const make = parts[3] ? decodeURIComponent(parts[3]) : undefined;
  const model = parts[4] ? decodeURIComponent(parts[4]) : undefined;
  if ([make, model].some(v => v !== undefined && (!v || /[\/\\\u0000-\u001f]/.test(v)))) return null;
  return {market: parts[2], ...(make ? {make} : {}), ...(model ? {model} : {})};
 } catch {return null;}
}
export function isCatalogSearchPath(pathname: string): boolean {
 return pathname === '/cars' || pathname === '/cars/green' || catalogRouteParams(pathname) !== null;
}
/** Keep all non-path parameters (including duplicate values), city, dealer, cursor and fragment. */
export function canonicalCatalogHref(href: string): string {
 if (!href.startsWith('/') || href.startsWith('//')) return href;
 const url = new URL(href, 'https://avtocena.com');
 const path = catalogRouteParams(url.pathname);
 if (url.pathname !== '/cars' && !path) return href;
 const market = path?.market || url.searchParams.get('market') || '';
 if (!Object.hasOwn(CATALOG_COUNTRIES, market) || (!path && url.searchParams.getAll('market').length !== 1)) return href;
 if (url.searchParams.get('stock') === 'green') return href;
 const make = path?.make || url.searchParams.get('make') || '';
 const model = path?.model || url.searchParams.get('model') || '';
 const single = (value: string) => Boolean(value) && !/[|,\/\\\u0000-\u001f]/.test(value) && value !== '.' && value !== '..';
 url.pathname = '/cars/' + market;
 url.searchParams.delete('market');
 if (single(make) && (path?.make || url.searchParams.getAll('make').length === 1)) {
  url.pathname += '/' + encodeURIComponent(make);
  url.searchParams.delete('make');
  if (single(model) && (path?.model || url.searchParams.getAll('model').length === 1)) {
   url.pathname += '/' + encodeURIComponent(model);
   url.searchParams.delete('model');
  }
 }
 return url.pathname + url.search + url.hash;
}
export function catalogSearchHeading(params: Record<string, string | string[] | undefined> = {}): string {
 const first = (v?: string | string[]) => Array.isArray(v) ? v[0] || '' : v || '';
 const market = first(params.market);
 const country = Object.hasOwn(CATALOG_COUNTRIES, market) ? CATALOG_COUNTRIES[market] : '';
 const name = [first(params.make) || first(params.brand), first(params.model)].filter(Boolean).join(' ').replace(/[<>"\u0000-\u001f]/g, '').slice(0, 160).trim();
 return name ? `${name}${country ? ` из ${country}` : ''}` : country ? `Авто из ${country} под заказ` : 'Каталог автомобилей';
}
