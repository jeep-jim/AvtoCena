from pathlib import Path

p = Path('apps/web/lib/catalog/offer-quality.ts')
s = p.read_text()
old = 'if (["autohome_new_china_open", "mobile_de_open"].includes(String(offer.sourceId || ""))) return 5;'
new = 'if (["autohome_new_china_open", "mobile_de_open", "auto_georgia_open"].includes(String(offer.sourceId || ""))) return 5;'
if old not in s and new not in s:
    raise SystemExit('minimum image source gate marker missing')
if old in s:
    s = s.replace(old, new, 1)
p.write_text(s)
if new not in p.read_text():
    raise SystemExit('Georgia min5 gate not applied')
print('georgia_min5_public_gate_ok')
