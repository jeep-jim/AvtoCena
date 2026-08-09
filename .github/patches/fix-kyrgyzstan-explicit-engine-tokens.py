from pathlib import Path

path = Path('apps/web/lib/catalog/mashina-kyrgyzstan-list-source.ts')
text = path.read_text()

old = '''function integer(value: unknown) {
  const parsed = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
'''
new = '''function integer(value: unknown) {
  const parsed = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
export function parseMashinaExplicitEngineLiters(value: unknown) {
  const text = String(value || "").replace(/,/g, ".");
  // Mashina.kg frequently writes exact source specs as "3.5 AT", "2.5hyb"
  // or "2.0d" without an L unit. Accept only a decimal displacement directly
  // bound to an explicit transmission/fuel/engine marker; bare numbers are never
  // treated as engine volume (protects Model 3, Q5, CX-5, years, prices, etc.).
  const match = text.match(/(?:^|\\s)([0-8](?:\\.[0-9]))\\s*(?=(?:A\\/?T|M\\/?T|AT|MT|CVT|DCT|DSG|hyb(?:rid)?|diesel|petrol|gasoline|turbo|T|d)\\b)/i);
  const liters = Number(match?.[1] || 0);
  return Number.isFinite(liters) && liters >= 0.6 && liters <= 8 ? liters : 0;
}
'''
if old not in text:
    raise SystemExit('integer anchor missing')
text = text.replace(old, new, 1)

old = '''  const model = after.split(/\\s+/).slice(0, 7).join(" ");
  return { make, model };
'''
new = '''  const modelSource = after.replace(/\\s+[0-8](?:[.,][0-9])\\s*(?:A\\/?T|M\\/?T|AT|MT|CVT|DCT|DSG|hyb(?:rid)?|diesel|petrol|gasoline|turbo|T|d)\\b[\\s\\S]*$/i, "").trim();
  const model = modelSource.split(/\\s+/).slice(0, 7).join(" ");
  return { make, model };
'''
if old not in text:
    raise SystemExit('model anchor missing')
text = text.replace(old, new, 1)

old = '''    const liters = Number(text.match(/\\b([0-9]+(?:[.,][0-9]+)?)\\s*L\\.?\\b/i)?.[1]?.replace(",", ".") || 0);
'''
new = '''    const unitLiters = Number(text.match(/\\b([0-9]+(?:[.,][0-9]+)?)\\s*L\\.?\\b/i)?.[1]?.replace(",", ".") || 0);
    const liters = unitLiters || parseMashinaExplicitEngineLiters(text);
'''
if text.count(old) != 1:
    raise SystemExit(f'listing liters anchor count={text.count(old)}')
text = text.replace(old, new, 1)

old = '''          const liters = Number(text.match(/\\b([0-9]+(?:[.,][0-9]+)?)\\s*(?:L|liter|litre)\\b/i)?.[1]?.replace(",", ".") || 0);
'''
new = '''          const unitLiters = Number(text.match(/\\b([0-9]+(?:[.,][0-9]+)?)\\s*(?:L|liter|litre)\\b/i)?.[1]?.replace(",", ".") || 0);
          const liters = unitLiters || parseMashinaExplicitEngineLiters(text);
'''
if text.count(old) != 1:
    raise SystemExit(f'detail liters anchor count={text.count(old)}')
text = text.replace(old, new, 1)

path.write_text(text)
