from pathlib import Path

path = Path("apps/web/lib/catalog/mashina-kyrgyzstan-list-source.ts")
text = path.read_text()

def replace_once(old: str, new: str):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one anchor, got {count}: {old[:120]!r}")
    text = text.replace(old, new, 1)

replace_once(
'''function compact(value: unknown) {
  return String(value || "").toLocaleLowerCase("en-US").replace(/[^\\p{L}\\p{N}]+/gu, "");
}
function imageUrls(markup: string, base: string) {''',
'''function compact(value: unknown) {
  return String(value || "").toLocaleLowerCase("en-US").replace(/[^\\p{L}\\p{N}]+/gu, "");
}
function mashinaImageIdentity(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    let pathname = decodeURIComponent(url.pathname).replace(/\\/{2,}/g, "/");
    if (!/\\.(?:jpe?g|png|webp|avif)$/i.test(pathname)) return "";
    if (host === "storage.mashina.kg" && pathname.startsWith("/catalog/images/")) {
      pathname = pathname.replace(/_(?:small|medium|large)(?=\\.(?:jpe?g|png|webp|avif)$)/i, "");
      return `${host}${pathname}`;
    }
    if (host === "im.mashina.kg" && pathname.startsWith("/tachka/images/")) {
      pathname = pathname.replace(/_\\d{2,5}x\\d{2,5}(?=\\.(?:jpe?g|png|webp|avif)$)/i, "");
      return `${host}${pathname}`;
    }
  } catch { /* invalid URL */ }
  return "";
}
function mashinaImageRank(value: string) {
  if (/_large\\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(value)) return 3_000_000;
  if (/_medium\\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(value)) return 2_000_000;
  if (/_small\\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(value)) return 1_000_000;
  const dimensions = value.match(/_(\\d{2,5})x(\\d{2,5})\\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i);
  return dimensions ? Number(dimensions[1]) * Number(dimensions[2]) : 1;
}
export function dedupeMashinaImageUrls(values: string[]) {
  const best = new Map<string, { url: string; rank: number; index: number }>();
  values.forEach((value, index) => {
    const identity = mashinaImageIdentity(value);
    if (!identity) return;
    const rank = mashinaImageRank(value);
    const current = best.get(identity);
    if (!current) best.set(identity, { url: value, rank, index });
    else if (rank > current.rank) best.set(identity, { url: value, rank, index: current.index });
  });
  return [...best.values()].sort((left, right) => left.index - right.index).map((item) => item.url);
}
function imageUrls(markup: string, base: string) {''')

replace_once(
'''  return [...new Set(values.map((value) => absoluteUrl(value, base)).filter((url) => /^https?:/i.test(url) && !BAD_IMAGE_RE.test(url)))];''',
'''  const sourceUrls = [...new Set(values
    .map((value) => absoluteUrl(value, base))
    .filter((url) => /^https?:/i.test(url) && !BAD_IMAGE_RE.test(url)))];
  return dedupeMashinaImageUrls(sourceUrls);''')

replace_once(
'''    let urls = [...new Set(raw?.images || row?.images || [])];''',
'''    let urls = dedupeMashinaImageUrls(raw?.images || row?.images || []);''')

replace_once(
'''          urls = [...new Set([...urls, ...imageUrls(detail.markup, detail.response.url || detailUrl)])];''',
'''          urls = dedupeMashinaImageUrls([...urls, ...imageUrls(detail.markup, detail.response.url || detailUrl)]);''')

path.write_text(text)
