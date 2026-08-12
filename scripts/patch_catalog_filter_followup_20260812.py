from pathlib import Path

p = Path('apps/web/components/catalog/CatalogFilters.tsx')
s = p.read_text()
a = '<span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black tracking-normal text-white">{chips.length}</span>'
b = '<span className="ac-filter-count-badge flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black tracking-normal text-white" style={{ color: "#fff", WebkitTextFillColor: "#fff" }}>{chips.length}</span>'
assert a in s, 'badge anchor missing'
s = s.replace(a, b, 1)
a = '    <div className="ac-range-fields-shell mt-2.5">\n      <div className="flex items-end justify-between gap-3"><div className="text-[10px] font-black uppercase tracking-[.13em] text-[var(--ac-muted)]">Диапазоны</div><div className="text-right text-[10px] font-bold text-[var(--ac-muted)]">Введите «от» и/или «до» — пустое поле не ограничивает выдачу</div></div>\n      <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-4">'
b = '    <div className="ac-range-fields-shell mt-2.5">\n      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">'
assert a in s, 'range helper anchor missing'
s = s.replace(a, b, 1)
a = '      .ac-filter-chip:hover{background:var(--ac-surface-3)}\n'
b = a + '      .ac-filter-count-badge{background:#ff353d!important;color:#fff!important;-webkit-text-fill-color:#fff!important}\n'
assert a in s, 'filter style anchor missing'
s = s.replace(a, b, 1)
p.write_text(s)

p = Path('apps/web/components/catalog/CatalogBrandMultiSelect.tsx')
s = p.read_text()
a = 'function joinMakes(values: string[]) {\n  return [...new Set(values.map(clean).filter(Boolean))].join(",");\n}\n\n'
assert a in s, 'joinMakes anchor missing'
s = s.replace(a, '', 1)
a = '  const selected = useMemo(() => splitMakes(value), [value]);\n  const selectedKeys = useMemo(() => new Set(selected.map((make) => make.toLocaleLowerCase("ru-RU"))), [selected]);'
b = '  const selected = useMemo(() => splitMakes(value), [value]);\n  const selectedKey = selected.length === 1 ? selected[0].toLocaleLowerCase("ru-RU") : "";'
assert a in s, 'selected keys anchor missing'
s = s.replace(a, b, 1)
a = '''  const toggle = (make: string) => {
    const key = make.toLocaleLowerCase("ru-RU");
    const next = selectedKeys.has(key)
      ? selected.filter((item) => item.toLocaleLowerCase("ru-RU") !== key)
      : [...selected, make];
    onChange(joinMakes(next));
  };'''
b = '''  const choose = (make: string) => {
    onChange(make);
    setOpen(false);
    setQuery("");
  };'''
assert a in s, 'toggle anchor missing'
s = s.replace(a, b, 1)
a = '''      <div className="mb-1.5 flex items-center gap-2">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти марку" className="ac-filter-search h-10 min-w-0 flex-1 rounded-xl px-3 text-sm font-bold outline-none" />
        {selected.length ? <button type="button" onClick={() => onChange("")} className="h-10 shrink-0 rounded-xl border border-red-500/35 px-3 text-[11px] font-black text-red-500">Очистить</button> : null}
      </div>
      <div className="ac-hide-scrollbar max-h-72 overflow-y-auto">'''
b = '''      <div className="mb-1.5">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти марку" className="ac-filter-search h-10 w-full rounded-xl px-3 text-sm font-bold outline-none" />
      </div>
      <div className="ac-hide-scrollbar max-h-72 overflow-y-auto">
        {selected.length ? <button type="button" onClick={() => choose("")} className="ac-filter-option mb-1 flex min-h-10 w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-black"><span>Любая марка</span><span className="text-[var(--ac-muted)]">×</span></button> : null}'''
assert a in s, 'top clear anchor missing'
s = s.replace(a, b, 1)
a = '          const active = selectedKeys.has(option.value.toLocaleLowerCase("ru-RU"));\n          const modelCount = Number(stats.modelCounts[option.value] || 0);\n          return <button key={option.value} type="button" data-facet-value={option.value} onClick={() => toggle(option.value)} className={`ac-filter-option flex min-h-12 w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left ${active ? "is-active" : ""}`} aria-pressed={active}>'
b = '          const active = selectedKey === option.value.toLocaleLowerCase("ru-RU");\n          const modelCount = Number(stats.modelCounts[option.value] || 0);\n          return <button key={option.value} type="button" data-facet-value={option.value} onClick={() => choose(option.value)} className={`ac-filter-option flex min-h-12 w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left ${active ? "is-active" : ""}`} aria-pressed={active}>'
assert a in s, 'top brand option anchor missing'
s = s.replace(a, b, 1)
p.write_text(s)

p = Path('apps/web/components/catalog/BrandLogoRail.tsx')
s = p.read_text()
a = 'className="min-h-10 rounded-xl border border-red-500/45 px-4 text-sm font-black text-red-500">Очистить</button>'
b = 'className="mr-7 min-h-10 rounded-xl border border-red-500/45 px-4 text-sm font-black text-red-500 md:mr-14">Очистить</button>'
assert a in s, 'modal clear anchor missing'
s = s.replace(a, b, 1)
a = '<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-500 text-[12px] font-black text-white" aria-label="Выбрано">✓</span>'
b = '<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-500 text-[12px] font-black text-white" style={{ color: "#fff", WebkitTextFillColor: "#fff" }} aria-label="Выбрано">✓</span>'
assert a in s, 'modal check anchor missing'
s = s.replace(a, b, 1)
p.write_text(s)

p = Path('apps/web/app/globals.css')
s = p.read_text()
if 'Filled red UI is a site-wide semantic contract' not in s:
    s += '''
/* Filled red UI is a site-wide semantic contract: its text is always white. */
:where([class~="bg-red-400"],[class~="bg-red-500"],[class~="bg-red-600"],[class~="bg-red-700"],[class~="bg-red-800"],[class~="bg-red-900"]) {
  color: #fff !important;
  -webkit-text-fill-color: #fff !important;
}
:where([class~="bg-red-400"],[class~="bg-red-500"],[class~="bg-red-600"],[class~="bg-red-700"],[class~="bg-red-800"],[class~="bg-red-900"]) :where(span,strong,small,p) {
  color: #fff !important;
  -webkit-text-fill-color: #fff !important;
}
'''
p.write_text(s)

Path('tests/catalog-filter-followup.test.ts').write_text(r'''import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const filters=fs.readFileSync(new URL("../apps/web/components/catalog/CatalogFilters.tsx",import.meta.url),"utf8");
const picker=fs.readFileSync(new URL("../apps/web/components/catalog/CatalogBrandMultiSelect.tsx",import.meta.url),"utf8");
const rail=fs.readFileSync(new URL("../apps/web/components/catalog/BrandLogoRail.tsx",import.meta.url),"utf8");
const globals=fs.readFileSync(new URL("../apps/web/app/globals.css",import.meta.url),"utf8");
test("upper make picker is single-select",()=>{assert.match(picker,/const choose = \(make: string\)/);assert.match(picker,/onChange\(make\)/);assert.doesNotMatch(picker,/const toggle =/);assert.match(picker,/onClick=\{\(\) => choose\(option.value\)\}/);});
test("quick logo rail keeps multi-brand selection",()=>{assert.match(rail,/\[\.\.\.selectedBrands, brand\]/);assert.match(rail,/selectedBrandKeys/);});
test("range helper copy is removed",()=>{assert.doesNotMatch(filters,/>Диапазоны</);assert.doesNotMatch(filters,/Введите «от»/);});
test("red filled UI uses white text",()=>{assert.match(filters,/ac-filter-count-badge[\s\S]*text-white/);assert.match(globals,/Filled red UI is a site-wide semantic contract/);assert.match(globals,/-webkit-text-fill-color: #fff !important/);assert.match(rail,/mr-7[\s\S]*md:mr-14[\s\S]*>Очистить<\/button>/);});
''')
