from pathlib import Path

p = Path('apps/web/lib/catalog/offer-quality.ts')
s = p.read_text()
s = s.replace('if (offer.sourceId === "autohome_new_china_open") return 5;', 'if (["autohome_new_china_open", "mobile_de_open"].includes(String(offer.sourceId || ""))) return 5;')
p.write_text(s)

p = Path('scripts/catalog-live-recovery-market.mjs')
s = p.read_text()
old = '''      if (source.sourceId === "autohome_new_china_open" && offer.images.length < 5) {\n        reject(rejections, "exact_gallery_below_5");\n        return null;\n      }'''
new = '''      if (["autohome_new_china_open", "mobile_de_open"].includes(source.sourceId) && offer.images.length < 5) {\n        reject(rejections, "exact_gallery_below_5");\n        return null;\n      }'''
if old not in s:
    raise SystemExit('collector image gate marker missing')
s = s.replace(old, new, 1)
p.write_text(s)

print('mobile_de_min_five_photos_patch_ok')
