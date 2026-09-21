import crypto from "node:crypto";
// Japanese auction images, unknown providers and Mobile.de (failed live server fetch) remain direct.
const HOSTS = /^(?:img\.kcar\.com|ci\.encar\.com|[^.]+\.autoimg\.cn|www\.autopapa\.ge|autopapa\.ge|static\.tnet\.ge|prod\.pictures\.autoscout24\.net|www\.dubicars\.com)$/i;
export function photoProxyEligible(raw: string, market: string) {
  try { const u = new URL(raw); return market !== "japan" && u.protocol === "https:" && !u.port && !u.username && !u.password && HOSTS.test(u.hostname); } catch { return false; }
}
function signature(url: string, market: string) {
  const secret = process.env.AUTH_SECRET;
  return secret ? crypto.createHmac("sha256", secret).update(`catalog-photo-v1\n${market}\n${url}`).digest("base64url") : "";
}
export function protectedPhotoUrl(url: string, market: string) {
  if (!photoProxyEligible(url, market) || process.env.CATALOG_PHOTO_PROXY === "0") return url;
  const sig = signature(url, market);
  return sig ? `/api/catalog/photo/${sig}?${new URLSearchParams({url, market})}` : url;
}
export function validPhotoSignature(url: string, market: string, sig: string) {
  const expected = signature(url, market);
  return Boolean(expected && /^[A-Za-z0-9_-]{43}$/.test(sig) && sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
}

export function supportedPhotoContentType(value: string) {
  return /^image\/(jpeg|jpg|png|webp|avif)(;|$)/i.test(value);
}
