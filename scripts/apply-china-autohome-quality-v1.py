from pathlib import Path

p = Path('apps/web/lib/catalog/autohome-new-exact-source.ts')
s = p.read_text()
old = r'const PRODUCT_IMAGE_RE = /^https:\/\/g\.autoimg\.cn\/@img\/car\d?\/cardfs\/product\/.+\.(?:jpe?g|png|webp|avif)(?:[?#].*)?$/i;'
new = r'''const PRODUCT_IMAGE_RE = /^(?:https:\/\/g\.autoimg\.cn\/@img\/car\d?\/cardfs\/product\/|https:\/\/car\d+\.autoimg\.cn\/cardfs\/product\/)/i;
const DIRECT_PRODUCT_IMAGE_RE = /^https:\/\/car\d+\.autoimg\.cn\/cardfs\/product\//i;'''
assert old in s, 'Autohome product regex anchor changed'
s = s.replace(old, new, 1)

old = '''function galleryUrl(specId: string, seriesId: string) {
  return `${CAR_BASE}/pic/series-s${specId}/${seriesId}.html`;
}'''
new = '''function galleryUrl(specId: string, seriesId: string) {
  return `${CAR_BASE}/pic/series-s${specId}/${seriesId}.html`;
}
function modernSpecGalleryUrl(specId: string, seriesId: string) {
  return `${SITE_BASE}/cars/imglist-x-x-${seriesId}-${specId}-x-x-x-x-x-1.html`;
}'''
assert old in s, 'galleryUrl anchor changed'
s = s.replace(old, new, 1)

old = r'''function exactProductImages(markup: string, base: string) {
  const values: string[] = [];
  for (const match of markup.matchAll(/(?:src|data-src|data-original|data-src2|content)=["']([^"']+)["']/gi)) values.push(match[1]);
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)) values.push(match[0].replace(/\\\//g, "/"));
  return [...new Set(values.map((value) => absolute(value, base)).filter((url) => PRODUCT_IMAGE_RE.test(url)))].slice(0, 30);
}'''
new = r'''function exactProductImages(markup: string, base: string) {
  const values: string[] = [];
  for (const match of markup.matchAll(/(?:src|data-src|data-original|data-src2|data-webp|content)=["']([^"']+)["']/gi)) values.push(match[1]);
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)) values.push(match[0].replace(/\\\//g, "/"));
  const urls = [...new Set(values.map((value) => absolute(value, base)).filter((url) => PRODUCT_IMAGE_RE.test(url)))];
  return [...urls.filter((url) => DIRECT_PRODUCT_IMAGE_RE.test(url)), ...urls.filter((url) => !DIRECT_PRODUCT_IMAGE_RE.test(url))].slice(0, 30);
}
function nextData(markup: string) {
  const match = markup.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}
function seriesIdFromSpecPage(markup: string) {
  const data = nextData(markup);
  const value = data?.props?.pageProps?.seriesId || data?.props?.pageProps?.specDetails?.bread?.seriesid;
  const parsed = String(value || markup.match(/\bseries\s*:\s*(\d+)/i)?.[1] || "");
  return /^\d+$/.test(parsed) ? parsed : "";
}
export function exactAutohomeSpecGalleryImages(markup: string, specId: string) {
  const data = nextData(markup);
  const groups = data?.props?.pageProps?.SeriesPicList?.picinfo?.callist;
  if (!Array.isArray(groups)) return [];
  const values: string[] = [];
  for (const group of groups) {
    for (const item of Array.isArray(group?.list) ? group.list : []) {
      if (Number(item?.specid) !== Number(specId)) continue;
      const url = absolute(String(item?.picpath || ""), SITE_BASE);
      if (DIRECT_PRODUCT_IMAGE_RE.test(url)) values.push(url);
    }
  }
  return [...new Set(values)].slice(0, 30);
}'''
assert old in s, 'exactProductImages anchor changed'
s = s.replace(old, new, 1)

old = '''    const fields = parseAutohomeExactConfigFields(configPage.body, specId);
    if (!fields) throw new Error(`autohome_new_exact_config_missing:${specId}`);
    const gallery = exactProductImages(specPage.body, specPage.response.url || specUrl(specId));
    const minimum = Math.max(5, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 5)), verifiedGallery = gallery.length >= minimum;'''
new = '''    const fields = parseAutohomeExactConfigFields(configPage.body, specId);
    if (!fields) throw new Error(`autohome_new_exact_config_missing:${specId}`);
    const seriesId = String(listing?.seriesId || seriesIdFromSpecPage(specPage.body) || "");
    const exactGalleryUrl = seriesId ? modernSpecGalleryUrl(specId, seriesId) : "";
    const galleryPage = exactGalleryUrl
      ? await fetchDecoded(exactGalleryUrl, specUrl(specId)).catch(() => null)
      : null;
    const minimum = Math.max(5, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 5));
    const exactGallery = galleryPage ? exactAutohomeSpecGalleryImages(galleryPage.body, specId) : [];
    const fallbackGallery = exactProductImages(specPage.body, specPage.response.url || specUrl(specId));
    const gallery = (exactGallery.length >= minimum
      ? exactGallery
      : [...new Set([...exactGallery, ...fallbackGallery])]).slice(0, 30);
    const verifiedGallery = gallery.length >= minimum && (exactGallery.length >= minimum || gallery.every((url) => PRODUCT_IMAGE_RE.test(url)));'''
assert old in s, 'fetchImages gallery anchor changed'
s = s.replace(old, new, 1)
s = s.replace('gallerySafetyMode: "autohome_spec_product_images_v1"', 'gallerySafetyMode: "autohome_exact_spec_next_data_picpath_v2"')
old = 'galleryUrl: listing?.galleryUrl, exactProductImages: gallery, detailIdentityVerified: true, photoIdentityVerified: verifiedGallery,'
new = 'galleryUrl: exactGalleryUrl || listing?.galleryUrl, legacyGalleryUrl: listing?.galleryUrl, exactProductImages: gallery, exactGalleryImageCount: exactGallery.length, detailIdentityVerified: true, photoIdentityVerified: verifiedGallery,'
assert old in s, 'raw gallery metadata anchor changed'
s = s.replace(old, new, 1)
p.write_text(s)

p = Path('apps/web/lib/catalog/spec-normalization.ts')
s = p.read_text()
old = 'if (/automatic|automatik|\\bauto\\b|a\\/t|\\bat\\b|автомат|自动|오토|자동/.test(text)) return "automatic";'
new = 'if (/automatic|automatik|\\bauto\\b|a\\/t|\\bat\\b|автомат|手自一体|自动挡?|오토|자동/.test(text)) return "automatic";'
assert old in s, 'inferTransmission automatic anchor changed'
p.write_text(s.replace(old, new, 1))

p = Path('apps/web/lib/catalog/presentation.ts')
s = p.read_text()
anchor = '  [/特斯拉/g, "Tesla "],\n'
insert = '  [/特斯拉/g, "Tesla "],\n  [/钧天纵横家/g, "Juntian Zonghengjia "],\n  [/钧天机械|钧天汽车|钧天/g, "Juntian "],\n'
assert anchor in s, 'Chinese alias insertion anchor changed'
s = s.replace(anchor, insert, 1)
old = '''export function catalogTransmissionName(value: unknown) {
  const raw = safeCatalogText(value).toLowerCase();
  if (!raw) return "уточняется";
  if (/automatic|auto|at|自动|오토|자동/.test(raw)) return "автомат";
  if (/manual|mt|手动|수동/.test(raw)) return "механика";
  if (/cvt|无级变速|вариатор/.test(raw)) return "вариатор";
  if (/robot|dct|双离合|робот/.test(raw)) return "робот";
  return translateCatalogText(raw) || "уточняется";
}'''
new = '''export function catalogTransmissionName(value: unknown) {
  const raw = safeCatalogText(value).toLowerCase();
  if (!raw) return "уточняется";
  const gears = Number(raw.match(/(?:^|\\D)(\\d{1,2})\\s*挡/)?.[1] || 0);
  const label = (name: string) => gears > 0 && gears <= 12 ? `${gears}-ступ. ${name}` : name;
  if (/cvt|无级变速|вариатор/.test(raw)) return "вариатор";
  if (/robot|dct|dsg|双离合|робот/.test(raw)) return label("робот");
  if (/manual|(?:^|\\W)mt(?:$|\\W)|手动|수동/.test(raw) && !/手自一体/.test(raw)) return label("механика");
  if (/automatic|auto|(?:^|\\W)at(?:$|\\W)|手自一体|自动挡?|오토|자동/.test(raw)) return label("автомат");
  return translateCatalogText(raw) || "уточняется";
}'''
assert old in s, 'catalogTransmissionName anchor changed'
p.write_text(s.replace(old, new, 1))
