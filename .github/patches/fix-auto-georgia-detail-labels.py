from pathlib import Path

p = Path("apps/web/lib/catalog/auto-georgia-strict-source.ts")
text = p.read_text()
old = '''    let urls = [...new Set((row.images || []).map(String).filter(Boolean))];
    if (detailUrl && urls.length < limit) {
      const detail = await request(detailUrl, detailUrl).catch(() => null);
      if (detail && identityMatches(detail.markup, row)) {
        urls = [...new Set([...urls, ...imageUrls(detail.markup, detail.response.url || detailUrl)])];
        const text = plainText(detail.markup);
        const cc = integer(text.match(/([0-9][0-9\\s,.']{2,5})\\s*(?:cc|cm3|cm³)/i)?.[1]);
        const liters = Number(text.match(/\\b([0-9]+(?:[.,][0-9]+)?)\\s*(?:L|liter|litre)\\b/i)?.[1]?.replace(",", ".") || 0);
        offer.engineCc ||= cc || (liters >= 0.3 && liters <= 15 ? Math.round(liters * 1_000) : undefined);
        offer.powerHp ||= integer(text.match(/\\b([0-9]{2,4})\\s*(?:HP|PS|horsepower)\\b/i)?.[1]);
        (offer.operational.raw as any).detailIdentityVerified = true;
      }
    }
'''
new = '''    let urls = [...new Set((row.images || []).map(String).filter(Boolean))];
    // AUTO.GE detail pages carry exact listing-bound specs even when the listing
    // card already exposes enough images. Fetch detail independently of image
    // count; in source_urls_only mode this does not download/cache image bytes.
    if (detailUrl) {
      const detail = await request(detailUrl, detailUrl).catch(() => null);
      if (detail && identityMatches(detail.markup, row)) {
        if (urls.length < limit) urls = [...new Set([...urls, ...imageUrls(detail.markup, detail.response.url || detailUrl)])];
        const text = plainText(detail.markup);
        const cc = integer(text.match(/([0-9][0-9\\s,.']{2,5})\\s*(?:cc|cm3|cm³)/i)?.[1]);
        const liters = Number(text.match(/\\b([0-9]+(?:[.,][0-9]+)?)\\s*(?:L|liter|litre)\\b/i)?.[1]?.replace(",", ".") || 0);
        const engineLabelRaw = text.match(/\\bEngine\\s+([0-9]+(?:[.,][0-9]+)?)(?=\\s|$)/i)?.[1]?.replace(",", ".") || "";
        const engineLabel = Number(engineLabelRaw || 0);
        const engineFromLabel = engineLabel >= 0.3 && engineLabel <= 15
          ? Math.round(engineLabel * 1_000)
          : engineLabel >= 300 && engineLabel <= 15_000 ? Math.round(engineLabel) : undefined;
        offer.engineCc ||= cc || (liters >= 0.3 && liters <= 15 ? Math.round(liters * 1_000) : undefined) || engineFromLabel;
        offer.powerHp ||= integer(text.match(/\\b([0-9]{2,4})\\s*(?:HP|PS|horsepower)\\b/i)?.[1]);
        const detailFuel = text.match(/\\bFuel\\s+(Hybrid Engine|Gasoline|Petrol|Diesel|Hybrid|Electric|LPG|CNG|Gas)\\b/i)?.[1];
        if (!offer.fuel && detailFuel) offer.fuel = detailFuel;
        (offer.operational.raw as any).detailIdentityVerified = true;
      }
    }
'''
if text.count(old) != 1:
    raise SystemExit(f"AUTO.GE detail parser anchor mismatch: {text.count(old)}")
p.write_text(text.replace(old, new, 1))
