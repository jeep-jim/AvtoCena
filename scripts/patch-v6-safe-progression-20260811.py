from pathlib import Path

path = Path('.github/workflows/catalog-v6-prestige-up-to-30k.yml')
s = path.read_text()

if 'PRESTIGE_PLAN_START_MODEL_INDEX: "91"' not in s:
    marker = '      PRESTIGE_PLAN_RAW_PER_MODEL: "200"\n'
    if marker not in s:
        raise SystemExit('plan marker missing')
    s = s.replace(marker, marker + '      PRESTIGE_PLAN_START_MODEL_INDEX: "91"\n', 1)

s = s.replace('      CATALOG_MAX_OFFERS_PER_MODEL: "100"', '      CATALOG_MAX_OFFERS_PER_MODEL: "20"')

old = '          CATALOG_AUDIT_ASSERT_MARKETS: japan\n'
new = '          CATALOG_AUDIT_ASSERT_MARKETS: korea,china,japan,uae,europe,georgia,kyrgyzstan\n'
if old in s:
    s = s.replace(old, new, 1)

if 'CATALOG_MAX_OFFERS_PER_MODEL: "100"' in s:
    raise SystemExit('unsafe model cap 100 remains')
if 'CATALOG_MAX_OFFERS_PER_MODEL: "20"' not in s:
    raise SystemExit('model cap20 missing')
if 'PRESTIGE_PLAN_START_MODEL_INDEX: "91"' not in s:
    raise SystemExit('deep traversal start missing')
if new.strip() not in s:
    raise SystemExit('all7 postpersist assert missing')

path.write_text(s)
print('v6_safe_progression_patch_ok')
