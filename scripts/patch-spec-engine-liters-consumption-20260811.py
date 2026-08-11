from pathlib import Path

p=Path('apps/web/lib/catalog/spec-normalization.ts')
s=p.read_text()
old='const liters = text.match(/(?:^|\\s)([0-9](?:[.,][0-9]){1,2})\\s*(?:l|л|литр)/i);'
new='const liters = text.match(/(?:^|\\s)([0-9](?:[.,][0-9]){1,2})\\s*(?:l|л|литр(?:а|ов)?)(?![A-Za-zА-Яа-яЁё])(?!(?:\\s*\\/\\s*100))/i);'
if old in s:
    s=s.replace(old,new,1)
elif new not in s:
    raise SystemExit('inferEngineCc liter regex marker missing')
p.write_text(s)
if new not in p.read_text(): raise SystemExit('safe engine liter regex not applied')
print('engine_liter_consumption_guard_ok')
