from pathlib import Path

path = Path('apps/web/components/catalog/CatalogFilters.tsx')
text = path.read_text()

text = text.replace('import { useEffect, useMemo, useRef, useState } from "react";\n', 'import { useEffect, useMemo, useRef, useState } from "react";\nimport { useRouter } from "next/navigation";\n', 1)

anchor = '''function sortParam(key: SortKey, direction: SortDir) {
'''
insert = '''function catalogQuery(draft: FilterDraft, sortKey: SortKey, sortDirection: SortDir) {
  const params = new URLSearchParams();
  const add = (key: string, value: string) => { if (clean(value)) params.set(key, clean(value)); };
  add("make", draft.make); add("model", draft.model); add("market", draft.market);
  add("bodyType", draft.bodyType); add("transmission", draft.transmission); add("fuel", draft.fuel); add("drive", draft.drive);
  add("yearFrom", draft.yearFrom); add("yearTo", draft.yearTo);
  add("budgetFrom", draft.budgetFrom); add("budget", draft.budget);
  add("mileageFrom", draft.mileageFrom); add("mileageTo", draft.mileageTo);
  add("engineFrom", draft.engineFrom); add("engineTo", draft.engineTo); add("powerTo", draft.powerTo);
  const sort = sortParam(sortKey, sortDirection);
  if (sort && sort !== "updatedAt") params.set("sort", sort);
  return params.toString();
}

'''
if anchor not in text: raise SystemExit('sortParam anchor missing')
text = text.replace(anchor, insert + anchor, 1)

# Move helper below sortParam because catalogQuery calls it as a function declaration (hoisted); this is valid JS/TS.

old_actions_start = 'function FilterActions({ mobile = false }: { mobile?: boolean }) {'
start = text.find(old_actions_start)
if start < 0: raise SystemExit('FilterActions missing')
end = text.find('\n}\n\nexport function CatalogFilters', start)
if end < 0: raise SystemExit('FilterActions end missing')
text = text[:start] + text[end+3:]

component_anchor = '''export function CatalogFilters({ initial, facets }: { initial: Record<string, string>; facets?: Facets }) {
  const formKey = useMemo(() => JSON.stringify(initial), [initial]);
'''
component_new = '''export function CatalogFilters({ initial, facets }: { initial: Record<string, string>; facets?: Facets }) {
  const router = useRouter();
  const formKey = useMemo(() => JSON.stringify(initial), [initial]);
'''
if component_anchor not in text: raise SystemExit('component anchor missing')
text = text.replace(component_anchor, component_new, 1)

sync_anchor = '''  useEffect(() => {
    setDraft(draftFromInitial(initial));
    const nextSort = initialSort(initial.sort || "");
    setSortKey(nextSort.key);
    setSortDirection(nextSort.direction);
  }, [formKey]);
'''
sync_new = sync_anchor + '''
  useEffect(() => {
    const nextInitial = draftFromInitial(initial);
    const initialSorting = initialSort(initial.sort || "");
    const serverQuery = catalogQuery(nextInitial, initialSorting.key, initialSorting.direction);
    const nextQuery = catalogQuery(draft, sortKey, sortDirection);
    if (nextQuery === serverQuery) return;
    const timer = window.setTimeout(() => {
      router.replace(nextQuery ? `/cars?${nextQuery}` : "/cars", { scroll: false });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [draft, sortKey, sortDirection, formKey, initial, router]);
'''
if sync_anchor not in text: raise SystemExit('sync anchor missing')
text = text.replace(sync_anchor, sync_new, 1)

old_row = '''      <div className="mt-2.5 grid grid-cols-[minmax(0,1.25fr)_minmax(145px,.58fr)_minmax(310px,1.05fr)_auto_54px] items-center gap-2.5">
        <PowerLimitCheckbox checked={draft.powerTo === "160"} onChange={(checked) => setField("powerTo", checked ? "160" : "")} />
        <ElectricCheckbox checked={electricOnly} onChange={setElectric} />
        <SortControl sortKey={sortKey} direction={sortDirection} onKeyChange={chooseSort} onDirectionChange={setSortDirection} />
        <button type="submit" className="avto-button flex h-13 items-center justify-center rounded-[15px] px-5 text-sm font-black">Показать</button>
        <button type="button" onClick={() => setExpanded((current) => !current)} className={`ac-filter-settings relative flex h-13 w-[54px] items-center justify-center rounded-[15px] ${expanded ? "is-active" : ""}`} aria-label="Расширенные фильтры" aria-expanded={expanded}><SlidersIcon />{advancedCount ? <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white">{advancedCount}</span> : null}</button>
      </div>'''
new_row = '''      <div className="mt-2.5 grid grid-cols-[minmax(0,1.15fr)_minmax(145px,.55fr)_minmax(80px,1fr)_minmax(310px,1.05fr)_54px] items-center gap-2.5">
        <PowerLimitCheckbox checked={draft.powerTo === "160"} onChange={(checked) => setField("powerTo", checked ? "160" : "")} />
        <ElectricCheckbox checked={electricOnly} onChange={setElectric} />
        <div aria-hidden="true" />
        <SortControl sortKey={sortKey} direction={sortDirection} onKeyChange={chooseSort} onDirectionChange={setSortDirection} />
        <button type="button" onClick={() => setExpanded((current) => !current)} className={`ac-filter-settings relative flex h-13 w-[54px] items-center justify-center rounded-[15px] ${expanded ? "is-active" : ""}`} aria-label="Расширенные фильтры" aria-expanded={expanded}><SlidersIcon />{advancedCount ? <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white">{advancedCount}</span> : null}</button>
      </div>'''
if old_row not in text: raise SystemExit('desktop row missing')
text = text.replace(old_row, new_row, 1)

old_footer = '''      <div className="shrink-0 border-t border-white/5 bg-[var(--ac-surface)] px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3"><FilterActions mobile /></div>
'''
if old_footer not in text: raise SystemExit('mobile footer missing')
text = text.replace(old_footer, '', 1)

# Forms are navigation containers now; prevent Enter from creating an accidental submit/reload.
text = text.replace('<form key={`desktop-${formKey}`} method="get"', '<form key={`desktop-${formKey}`} method="get" onSubmit={(event) => event.preventDefault()}', 1)
text = text.replace('<form key={`mobile-${formKey}`} method="get" role="dialog"', '<form key={`mobile-${formKey}`} method="get" onSubmit={(event) => event.preventDefault()} role="dialog"', 1)

path.write_text(text)

# Update regression expectations: there are no apply buttons; filters update the URL automatically.
test = Path('tests/catalog-filter-ui.test.ts')
t = test.read_text()
old = '''test("catalog filter forms can be applied and show the active query", () => {
  const source = fs.readFileSync("apps/web/components/catalog/CatalogFilters.tsx", "utf8");
  assert.match(source, /type="submit"/);
  assert.match(source, /Показать автомобили/);
  assert.match(source, /aria-label="Выбранные параметры"/);
  assert.match(source, /key=\\{`desktop-\\$\\{formKey\\}`\\}/);
  assert.match(source, /key=\\{`mobile-\\$\\{formKey\\}`\\}/);
});'''
new = '''test("catalog filters apply automatically and show the active query", () => {
  const source = fs.readFileSync("apps/web/components/catalog/CatalogFilters.tsx", "utf8");
  assert.match(source, /router\\.replace/);
  assert.match(source, /catalogQuery/);
  assert.doesNotMatch(source, /Показать автомобили/);
  assert.doesNotMatch(source, /type="submit"/);
  assert.match(source, /aria-label="Выбранные параметры"/);
  assert.match(source, /key=\\{`desktop-\\$\\{formKey\\}`\\}/);
  assert.match(source, /key=\\{`mobile-\\$\\{formKey\\}`\\}/);
});'''
if old not in t: raise SystemExit('old regression test missing')
test.write_text(t.replace(old, new, 1))
