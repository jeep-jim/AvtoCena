from pathlib import Path
# Fontsource's variable package exposes wght.css, not static subset CSS.
# The bundled unicode ranges load only characters used by the page.
p=Path('apps/web/app/(public)/layout.tsx');s=p.read_text()
old="import '@fontsource-variable/onest/cyrillic.css';\nimport '@fontsource-variable/onest/latin.css';"
assert s.count(old)==1
p.write_text(s.replace(old,"import '@fontsource-variable/onest/wght.css';"))
p=Path('tests/catalog-reference-routes.test.ts');s=p.read_text()
old="assert.match(layout,/@fontsource-variable\\/onest\\/cyrillic.css/);assert.match(layout,/@fontsource-variable\\/onest\\/latin.css/);"
assert s.count(old)==1
p.write_text(s.replace(old,"assert.match(layout,/@fontsource-variable\\/onest\\/wght.css/);"))
p=Path('docs/operations/2026-11-07-zma-reference-findings.md');s=p.read_text()
s=s.replace('Локальная сборка, только кириллица/латиница, public-only веса 400/600/700.','Локальная сборка wght.css, unicode-range загружает только используемые символы; public-only веса 400/600/700.')
s+='\nПроверка интеграции: run 42337250523 — 2804/2804 регрессий, typecheck SUCCESS; build остановлен из-за отсутствующих subset CSS в variable-пакете. Импорт исправлен на документированный wght.css, сетевое подключение шрифта не добавлено. Полный повторный прогон обязателен.\n'
p.write_text(s)
print('DOCUMENTED_VARIABLE_FONT_IMPORT_APPLIED')
