from pathlib import Path

changes = {}
def replace(path, old, new):
    text = changes.get(path, Path(path).read_text())
    if text.count(old) != 1:
        raise RuntimeError(f'{path}: expected one anchor: {old[:100]!r}')
    changes[path] = text.replace(old, new, 1)

page = 'apps/web/app/(public)/cars/page.tsx'
home = 'apps/web/components/home/HomePageClient.tsx'
replace(page, 'import Link from "next/link";', 'import { formatCatalogCount } from "@/lib/catalog/count-format";\nimport Link from "next/link";')
replace(page, '        <p className="mt-3 hidden text-sm font-bold leading-6 text-white/52 md:text-base lg:block">Найдено: {total}</p>\n', '')
replace(page, '      <CatalogFilters initial={initial} facets={facets} />', '''      <p className="ac-catalog-result-count mt-3 flex min-w-0 items-center gap-2 text-sm font-bold leading-6 text-[var(--ac-text)] md:text-base" role="status" aria-live="polite" aria-atomic="true" data-catalog-result-count={total}>
        <span className="ac-pulse-dot ac-pulse-dot--status" aria-hidden="true"><span /></span>
        <span>Найдено: <span className="whitespace-nowrap tabular-nums" data-catalog-result-value>{formatCatalogCount(total)}</span></span>
      </p>
      <CatalogFilters initial={initial} facets={facets} />''')
replace(page, '<span className="text-sm text-[var(--ac-muted)] md:text-base">· {market.total}</span>', '<span className="whitespace-nowrap text-sm text-[var(--ac-muted)] md:text-base" data-catalog-market-count={market.total}>· {formatCatalogCount(market.total)}</span>')
replace(home, 'import Link from "next/link";', 'import { formatCatalogCount } from "@/lib/catalog/count-format";\nimport Link from "next/link";')
replace(home, '`Нашли ${count} вариантов`', '`Нашли ${formatCatalogCount(count)} вариантов`')
replace(home, '{electricOnly ? group.total : marketCounts[group.id] || group.total}', '{formatCatalogCount(electricOnly ? group.total : marketCounts[group.id] || group.total)}')
for path, text in changes.items():
    Path(path).write_text(text)

out = Path('artifacts/catalog-result-count')
out.mkdir(parents=True, exist_ok=True)
# Save actual global/scoped styles and current source for programmatic regression review.
for name in ['globals.css','catalog-ui.css','public-polish.css']:
    (out / name).write_text(Path('apps/web/app', name).read_text())
for source, name in [('apps/web/app/layout.tsx','root-layout.tsx'),('apps/web/app/(public)/layout.tsx','public-layout.tsx'),(page,'catalog-page.tsx'),(home,'HomePageClient.tsx')]:
    (out / name).write_text(Path(source).read_text())
print('Applied guarded counter and number-formatting edits to catalog and home.')
for name in ['catalog-ui.css','public-polish.css','public-layout.tsx']:
    lines = (out / name).read_text().splitlines()
    matches = set()
    for i,line in enumerate(lines):
        if 'ac-pulse-dot' in line or ('ac-catalog-page' in line and ('first' in line or 'max-w-4xl' in line or 'p' in line)):
            matches.update(range(max(0,i-1),min(len(lines),i+5)))
    print('\nSTYLES',name)
    for i in sorted(matches): print(f'{i+1}: {lines[i]}')
