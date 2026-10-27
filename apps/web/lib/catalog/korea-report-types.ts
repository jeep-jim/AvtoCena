export type KoreaSourceReportKind = 'history' | 'inspection';
export type KoreaReportLink = {version: 2; offerId: string; lot: string; kind: KoreaSourceReportKind; href: string; originalHref: string};

/** Shared validation: only supplier report URLs, never arbitrary frames or redirects. */
export function exactKoreaReportUrl(value: unknown, lot: string, kind: KoreaSourceReportKind): string | null {
 if (typeof value !== 'string' || value.length > 2048 || !/^\d{6,10}$/.test(lot)) return null;
 let url: URL; try { url = new URL(value); } catch { return null; }
 if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
 if (kind === 'history' && url.hostname === 'fem.encar.com' && url.pathname === `/cars/report/accident/${lot}` && !url.search) return url.href;
 if (kind === 'inspection' && url.hostname === 'www.encar.com' && url.pathname === '/md/sl/mdsl_regcar.do' && url.searchParams.get('method') === 'inspectionViewNew' && url.searchParams.get('carid') === lot && [...url.searchParams.keys()].length === 2) return url.href;
 return null;
}
export function koreaWrapperUrl(value: unknown): string | null {
 if (typeof value !== 'string' || value.length > 600) return null;
 let url: URL; try { url = new URL(value); } catch { return null; }
 return url.protocol === 'https:' && url.hostname === 'tru.ru' && !url.port && !url.username && !url.password && !url.search && !url.hash && /^\/korea\/[A-Za-z0-9_-]{20,512}$/.test(url.pathname) ? url.href : null;
}
export function validKoreaReportLink(value: unknown, offerId: string, lot: string, kind: KoreaSourceReportKind): value is KoreaReportLink {
 if (!value || typeof value !== 'object') return false;
 const v = value as KoreaReportLink;
 return v.version === 2 && v.offerId === offerId && v.lot === lot && v.kind === kind && Boolean(exactKoreaReportUrl(v.originalHref, lot, kind)) && (v.href === v.originalHref || Boolean(koreaWrapperUrl(v.href)));
}
