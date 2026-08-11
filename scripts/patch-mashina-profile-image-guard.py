from pathlib import Path

# Source parser: never collect seller/profile images from /users/.
p = Path('apps/web/lib/catalog/mashina-kyrgyzstan-list-source.ts')
s = p.read_text()
s = s.replace(
'const BAD_IMAGE_RE = /logo|icon|avatar|qrcode|qr-code|placeholder|banner|sprite|tracking|pixel|favicon|appstore|googleplay|no[-_ ]?(?:photo|image)/i;',
'const BAD_IMAGE_RE = /logo|icon|avatar|\\/users\\/|qrcode|qr-code|placeholder|banner|sprite|tracking|pixel|favicon|appstore|googleplay|no[-_ ]?(?:photo|image)/i;'
)
p.write_text(s)

# Public gallery ranking: suppress already-published Mashina profile images immediately.
p = Path('apps/web/lib/catalog/image-quality.ts')
s = p.read_text()
s = s.replace(
'promo|promotion|advert|ad_|loan|credit|warranty|guarantee|inspection|diagnosis|service|support|feature|header|footer|sprite|icon|logo|obd|low[-_]?rate|placeholder',
'promo|promotion|advert|ad_|loan|credit|warranty|guarantee|inspection|diagnosis|service|support|feature|header|footer|sprite|icon|logo|users|obd|low[-_]?rate|placeholder'
)
p.write_text(s)

# Canonical public-quality filtering: stale rows containing profile photos must not count those as vehicle images.
p = Path('apps/web/lib/catalog/offer-quality.ts')
s = p.read_text()
s = s.replace(
'|camera[-_ ]?off|dummy[-_ ]?(?:car|image)|cdn-cgi|challenge-platform)',
'|camera[-_ ]?off|dummy[-_ ]?(?:car|image)|\\/users\\/|cdn-cgi|challenge-platform)'
)
p.write_text(s)

for path in ['apps/web/lib/catalog/mashina-kyrgyzstan-list-source.ts','apps/web/lib/catalog/image-quality.ts','apps/web/lib/catalog/offer-quality.ts']:
    text = Path(path).read_text()
    if 'users' not in text:
        raise SystemExit(f'users guard missing in {path}')
print('mashina_profile_image_guard_patch_ok')
