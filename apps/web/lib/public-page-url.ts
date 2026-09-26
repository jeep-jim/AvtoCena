const privatePrefixes = ['/admin', '/crm', '/login', '/api', '/auth', '/internal'];
export function isPublicPagePath(pathname: string) {
 return !privatePrefixes.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
export function publicPageUrl(href: string, savedVersion?: string) {
 const url = new URL(href);
 if (!['https:', 'http:'].includes(url.protocol) || !isPublicPagePath(url.pathname)) return null;
 if (savedVersion && url.pathname.startsWith('/cars/')) url.searchParams.set('calculation', savedVersion);
 return url.toString();
}
export function currentPublicPageUrl() {
 return publicPageUrl(window.location.href, document.querySelector<HTMLElement>('[data-offer-saved-version]')?.dataset.offerSavedVersion);
}
