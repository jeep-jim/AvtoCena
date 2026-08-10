from pathlib import Path

p = Path('apps/web/lib/catalog/autoscout-exact-source.ts')
s = p.read_text()
old = '''    const fuel = clean(listing.vehicle?.fuel || detailValue(listing.vehicleDetails, /fuel/i));
'''
new = '''    const sourceFuelToken = /-electric-/i.test(sourceUrl)
      && !/-electric-(?:gasoline|petrol|diesel)|-(?:gasoline|petrol|diesel)-electric-|hybrid|phev|hev/i.test(sourceUrl)
      ? "Electric"
      : "";
    const fuel = clean(listing.vehicle?.fuel || detailValue(listing.vehicleDetails, /fuel/i) || sourceFuelToken);
'''
if old not in s:
    raise SystemExit('AutoScout fuel anchor not found')
s = s.replace(old, new, 1)
p.write_text(s)
print('patched AutoScout exact electric classification fallback')
