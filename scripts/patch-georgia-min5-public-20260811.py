from pathlib import Path

# Canonical public gate: exact AUTO.GE listings must have at least five photos.
p = Path('apps/web/lib/catalog/offer-quality.ts')
s = p.read_text()
old = 'if (["autohome_new_china_open", "mobile_de_open"].includes(String(offer.sourceId || ""))) return 5;'
new = 'if (["autohome_new_china_open", "mobile_de_open", "auto_georgia_open"].includes(String(offer.sourceId || ""))) return 5;'
if old not in s and new not in s:
    raise SystemExit('minimum image source gate marker missing')
if old in s:
    s = s.replace(old, new, 1)
p.write_text(s)

# Generic daily recovery previously trusted the two listing-card previews and
# skipped source.fetchImages(). AUTO.GE's adapter now has an identity-verified
# exact detail gallery, so force this source through fetchImages and require >=5.
p = Path('scripts/catalog-live-recovery-market.mjs')
s = p.read_text()
old_branch = 'if (trustedListingImages.length) {'
new_branch = 'if (trustedListingImages.length && source.sourceId !== "auto_georgia_open") {'
if old_branch in s:
    s = s.replace(old_branch, new_branch, 1)
elif new_branch not in s:
    raise SystemExit('trusted listing image branch marker missing')
old_gate = 'if (["autohome_new_china_open", "mobile_de_open"].includes(source.sourceId) && offer.images.length < 5) {'
new_gate = 'if (["autohome_new_china_open", "mobile_de_open", "auto_georgia_open"].includes(source.sourceId) && offer.images.length < 5) {'
if old_gate in s:
    s = s.replace(old_gate, new_gate, 1)
elif new_gate not in s:
    raise SystemExit('collector min5 gate marker missing')
p.write_text(s)

checks = {
    'apps/web/lib/catalog/offer-quality.ts': new,
    'scripts/catalog-live-recovery-market.mjs': new_branch,
}
for path, marker in checks.items():
    if marker not in Path(path).read_text():
        raise SystemExit(f'missing marker in {path}')
if new_gate not in Path('scripts/catalog-live-recovery-market.mjs').read_text():
    raise SystemExit('Georgia collector min5 gate not applied')
print('georgia_exact_gallery_generic_and_public_gate_ok')
