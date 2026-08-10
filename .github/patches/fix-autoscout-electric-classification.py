from pathlib import Path

p = Path('apps/web/lib/catalog/autoscout-exact-source.ts')
s = p.read_text()
old_type = '''  fuel?: string;\n  transmission?: string;\n'''
new_type = '''  fuel?: string;\n  powertrainKind?: "electric";\n  transmission?: string;\n'''
if old_type not in s:
    raise SystemExit('AutoScout row type anchor not found')
s = s.replace(old_type, new_type, 1)
old_fuel = '''    const fuel = clean(listing.vehicle?.fuel || detailValue(listing.vehicleDetails, /fuel/i));\n'''
new_fuel = '''    const sourcePureElectric = /-electric-/i.test(sourceUrl)\n      && !/-electric-(?:gasoline|petrol|diesel)|-(?:gasoline|petrol|diesel)-electric-|hybrid|phev|hev/i.test(sourceUrl);\n    const fuel = clean(listing.vehicle?.fuel || detailValue(listing.vehicleDetails, /fuel/i) || (sourcePureElectric ? "Electric" : ""));\n'''
if old_fuel not in s:
    raise SystemExit('AutoScout fuel anchor not found')
s = s.replace(old_fuel, new_fuel, 1)
old_row = '''      fuel,\n      transmission,\n'''
new_row = '''      fuel,\n      powertrainKind: sourcePureElectric ? "electric" : undefined,\n      transmission,\n'''
if old_row not in s:
    raise SystemExit('AutoScout parsed-row anchor not found')
s = s.replace(old_row, new_row, 1)
old_offer = '''      fuel: row.fuel,\n      transmission: row.transmission,\n'''
new_offer = '''      fuel: row.fuel,\n      powertrainKind: row.powertrainKind,\n      transmission: row.transmission,\n'''
if old_offer not in s:
    raise SystemExit('AutoScout normalize-offer anchor not found')
s = s.replace(old_offer, new_offer, 1)
p.write_text(s)
print('patched AutoScout exact source-bound pure-EV classification')
