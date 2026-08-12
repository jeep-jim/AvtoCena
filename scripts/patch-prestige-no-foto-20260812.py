from pathlib import Path
p=Path('apps/web/lib/catalog/prestige-japan-exact-source.ts')
s=p.read_text()
s=s.replace('  images: string[];\n  rawFields: Record<string, string>;','  images: string[];\n  coverContentVerified?: boolean;\n  rawFields: Record<string, string>;')
anchor='''function exactImages(markup: string, base: string) {
  const values: string[] = [];
  for (const match of markup.matchAll(/<img\\b[^>]*\\bsrc\\s*=\\s*["']([^"']+)["'][^>]*>/gi)) values.push(absolute(match[1], base));
  return [...new Set(values.filter((url) => EXACT_IMAGE_RE.test(url)))].slice(0, 30);
}
'''
insert=anchor+'''export type PrestigeJapanImageProbeKind = "vehicle" | "placeholder" | "unknown";
export function prestigeJapanImageProbeKind(contentTypeValue: unknown, bytesValue: Uint8Array | number[]) : PrestigeJapanImageProbeKind {
  const contentType = clean(contentTypeValue).toLowerCase().split(";")[0];
  const bytes = bytesValue instanceof Uint8Array ? bytesValue : new Uint8Array(bytesValue || []);
  const gif = bytes.length >= 6
    && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38
    && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61;
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/gif" || gif) return "placeholder";
  if (contentType === "image/jpeg" && jpeg) return "vehicle";
  return "unknown";
}
async function probeExactImage(url: string): Promise<PrestigeJapanImageProbeKind> {
  const attempts = Math.max(1, Math.min(3, Number(process.env.PRESTIGE_JAPAN_IMAGE_PROBE_ATTEMPTS || 2)));
  const timeout = Math.max(4_000, Number(process.env.PRESTIGE_JAPAN_IMAGE_PROBE_TIMEOUT_MS || 12_000));
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { ...HEADERS, accept: "image/avif,image/webp,image/jpeg,image/*,*/*;q=0.8", range: "bytes=0-5", referer: LANDING },
        redirect: "follow",
        signal: AbortSignal.timeout(timeout),
      });
      if (!response.ok) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      const kind = prestigeJapanImageProbeKind(response.headers.get("content-type"), bytes.subarray(0, 6));
      if (kind !== "unknown") return kind;
    } catch { /* retry isolated AJES probe */ }
  }
  return "unknown";
}
'''
if anchor not in s: raise SystemExit('exactImages anchor missing')
s=s.replace(anchor,insert,1)
old='''  private async exactDetail(url: string) {
    if (!DETAIL_RE.test(url)) return null;
    const { body } = await request(url, { headers: { referer: LANDING } });
    return parsePrestigeJapanExactDetail(body, url);
  }
'''
new='''  private async exactDetail(url: string) {
    if (!DETAIL_RE.test(url)) return null;
    const { body } = await request(url, { headers: { referer: LANDING } });
    const row = parsePrestigeJapanExactDetail(body, url);
    if (!row || row.images.length < 5) return row;

    // AJES serves its visual `NO FOTO` card behind opaque /imgs/<token> URLs.
    // The URL therefore looks identical to a real auction photo and cannot be
    // filtered by pathname. A six-byte ranged GET is enough to distinguish the
    // verified JPEG vehicle cover from AJES' GIF placeholder without downloading
    // the full image. Fail closed when the source cannot verify the cover.
    const coverKind = await probeExactImage(row.images[0]);
    if (coverKind !== "vehicle") return null;
    row.coverContentVerified = true;
    return row;
  }
'''
if old not in s: raise SystemExit('exactDetail block missing')
s=s.replace(old,new,1)
s=s.replace('galleryVerified: row.images.length >= 5, gallerySafetyMode: "prestige_ajes_exact_detail_v1",','galleryVerified: row.coverContentVerified === true && row.images.length >= 5, gallerySafetyMode: "prestige_ajes_exact_detail_v2_cover_content_verified",')
s=s.replace('raw: { detailIdentityVerified: true, photoIdentityVerified: true, listingBoundImages: true, carId: row.carId,','raw: { detailIdentityVerified: true, photoIdentityVerified: true, listingBoundImages: true, coverContentVerified: row.coverContentVerified === true, carId: row.carId,')
p.write_text(s)

t=Path('tests/prestige-japan-no-foto-20260812.test.ts')
t.write_text('''import assert from "node:assert/strict";\nimport test from "node:test";\nimport { prestigeJapanImageProbeKind } from "../apps/web/lib/catalog/prestige-japan-exact-source";\n\ntest("AJES GIF89a content is rejected as a source NO FOTO placeholder", () => {\n  assert.equal(prestigeJapanImageProbeKind("image/gif", new Uint8Array([0x47,0x49,0x46,0x38,0x39,0x61])), "placeholder");\n});\n\ntest("AJES JPEG magic is accepted only with JPEG content type", () => {\n  const jpeg = new Uint8Array([0xff,0xd8,0xff,0xe0,0x00,0x10]);\n  assert.equal(prestigeJapanImageProbeKind("image/jpeg", jpeg), "vehicle");\n  assert.equal(prestigeJapanImageProbeKind("application/octet-stream", jpeg), "unknown");\n});\n\ntest("unknown image prefix fails closed instead of becoming a public cover", () => {\n  assert.equal(prestigeJapanImageProbeKind("image/png", new Uint8Array([1,2,3,4,5,6])), "unknown");\n});\n''')
