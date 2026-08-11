from pathlib import Path
p=Path('apps/web/app/(public)/cars/offer/[id]/page.tsx')
s=p.read_text()
old='''  const powerTile = powerDisplay && electrified\n    ? { label: "30-минутная мощность", value: powerDisplay.thirtyMinuteLabel, icon: "thirtyMinute" as const, info: thirtyMinuteInfo }\n    : preliminaryPricing && electrified\n      ? { label: "30-минутная мощность", value: "30 мин: уточняется", icon: "thirtyMinute" as const, info: thirtyMinuteInfo }\n      : null;'''
new='''  const powerTile = powerDisplay && electrified\n    ? { label: "30-минутная мощность", value: powerDisplay.thirtyMinuteLabel, icon: "thirtyMinute" as const, info: thirtyMinuteInfo }\n    : null;'''
if old not in s: raise SystemExit('powerTile fallback block missing')
s=s.replace(old,new,1)
p.write_text(s)
print('exact_30min_tile_only_patch_ok')
