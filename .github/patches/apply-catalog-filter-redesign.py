from pathlib import Path
import base64
import gzip

REPO = Path(".")
PARTS = [REPO / f".github/patches/catalog-filter-redesign.part{i}" for i in range(1, 6)]


def replace_once(path: str, old: str, new: str) -> None:
    file = REPO / path
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one anchor, got {count}")
    file.write_text(text.replace(old, new, 1))


payload = "".join(part.read_text().strip() for part in PARTS)
(REPO / "apps/web/components/catalog/CatalogFilters.tsx").write_bytes(
    gzip.decompress(base64.b64decode(payload))
)

replace_once(
    "apps/web/lib/catalog/storage.ts",
    '''export function catalogSearchProjectionSort(rows: CatalogSearchProjection[], sort = "updatedAt") {
  return rows.sort((a, b) => sort === "totalRub" ? projectionNumber(a.totalRub, Infinity) - projectionNumber(b.totalRub, Infinity)
    : sort === "year" ? Number(b.year || 0) - Number(a.year || 0)
      : sort === "mileage" ? projectionNumber(a.mileageKm, 0) - projectionNumber(b.mileageKm, 0)
        : projectionFreshness(b) - projectionFreshness(a) || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}''',
    '''export function catalogSearchProjectionSort(rows: CatalogSearchProjection[], sort = "updatedAt") {
  return rows.sort((a, b) => sort === "totalRub" ? projectionNumber(a.totalRub, Infinity) - projectionNumber(b.totalRub, Infinity)
    : sort === "totalRubDesc" ? projectionNumber(b.totalRub, -Infinity) - projectionNumber(a.totalRub, -Infinity)
      : sort === "year" ? Number(b.year || 0) - Number(a.year || 0)
        : sort === "yearAsc" ? projectionNumber(a.year, Infinity) - projectionNumber(b.year, Infinity)
          : sort === "mileage" ? projectionNumber(a.mileageKm, 0) - projectionNumber(b.mileageKm, 0)
            : projectionFreshness(b) - projectionFreshness(a) || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}''',
)

replace_once(
    "apps/web/app/(public)/cars/page.tsx",
    'const SUPPORTED_SORTS = new Set(["updatedAt", "totalRub", "year", "mileage"]);',
    'const SUPPORTED_SORTS = new Set(["updatedAt", "totalRub", "totalRubDesc", "year", "yearAsc", "mileage"]);',
)

replace_once(
    "apps/web/app/(public)/cars/page.tsx",
    '''function sortCatalogRows(rows: any[], sort: string) {
  const sorted = [...rows];
  if (sort === "totalRub") return sorted.sort((left, right) => {
    const a = offerRubValue(left) || Number.POSITIVE_INFINITY;
    const b = offerRubValue(right) || Number.POSITIVE_INFINITY;
    return a - b || businessOrder(left, right);
  });
  if (sort === "year") return sorted.sort((left, right) => Number(right?.year || 0) - Number(left?.year || 0) || businessOrder(left, right));
  if (sort === "mileage") return sorted.sort((left, right) => {
    const a = Number(left?.mileageKm || 0) || Number.POSITIVE_INFINITY;
    const b = Number(right?.mileageKm || 0) || Number.POSITIVE_INFINITY;
    return a - b || businessOrder(left, right);
  });
  return sorted.sort(businessOrder);
}''',
    '''function sortCatalogRows(rows: any[], sort: string) {
  const sorted = [...rows];
  if (sort === "totalRub" || sort === "totalRubDesc") return sorted.sort((left, right) => {
    const a = offerRubValue(left) || Number.POSITIVE_INFINITY;
    const b = offerRubValue(right) || Number.POSITIVE_INFINITY;
    if (!Number.isFinite(a) && !Number.isFinite(b)) return businessOrder(left, right);
    if (!Number.isFinite(a)) return 1;
    if (!Number.isFinite(b)) return -1;
    const direction = sort === "totalRubDesc" ? -1 : 1;
    return (a - b) * direction || businessOrder(left, right);
  });
  if (sort === "year" || sort === "yearAsc") {
    const direction = sort === "yearAsc" ? 1 : -1;
    return sorted.sort((left, right) => (Number(left?.year || 0) - Number(right?.year || 0)) * direction || businessOrder(left, right));
  }
  if (sort === "mileage") return sorted.sort((left, right) => {
    const a = Number(left?.mileageKm || 0) || Number.POSITIVE_INFINITY;
    const b = Number(right?.mileageKm || 0) || Number.POSITIVE_INFINITY;
    return a - b || businessOrder(left, right);
  });
  return sorted.sort(businessOrder);
}''',
)

home_sheet_css = '''/* Mobile filter overlays use the same bottom-sheet interaction as currency details. */
@media (max-width: 1023px) {
  .ac-home-page > div.fixed:has(> .ac-home-filter-drawer) {
    display: flex !important;
    align-items: flex-end !important;
    justify-content: center !important;
    background: rgba(0,0,0,.62) !important;
    -webkit-backdrop-filter: blur(8px) !important;
    backdrop-filter: blur(8px) !important;
  }
  .ac-home-page > div.fixed > .ac-home-filter-drawer {
    position: relative !important;
    inset: auto !important;
    width: 100% !important;
    max-width: none !important;
    max-height: min(91dvh, 820px) !important;
    border-radius: 30px 30px 0 0 !important;
    padding: 28px 16px calc(14px + env(safe-area-inset-bottom)) !important;
    overflow-y: auto !important;
    background: var(--ac-surface) !important;
    color: var(--ac-text) !important;
    overscroll-behavior: contain !important;
  }
  .ac-home-page > div.fixed > .ac-home-filter-drawer::before {
    content: "" !important;
    position: absolute !important;
    top: 9px !important;
    left: 50% !important;
    width: 48px !important;
    height: 6px !important;
    transform: translateX(-50%) !important;
    border-radius: 999px !important;
    background: var(--ac-muted) !important;
    opacity: .3 !important;
  }
  .ac-home-page .ac-home-filter-drawer__header {
    margin: 0 0 14px !important;
    padding: 0 !important;
  }
  .ac-home-page .ac-home-filter-drawer__header button { border-radius: 999px !important; }
  .ac-home-page .ac-home-filter-drawer__fields {
    display: flex !important;
    flex-direction: column !important;
    gap: 10px !important;
  }
  .ac-home-page .ac-home-filter-drawer__budget {
    padding: 10px 12px !important;
    border-radius: 16px !important;
    background: var(--ac-surface-2) !important;
  }
  .ac-home-page .ac-home-filter-drawer__actions {
    position: sticky !important;
    bottom: -1px !important;
    z-index: 20 !important;
    margin: 12px -4px -4px !important;
    padding: 10px 4px 4px !important;
    background: var(--ac-surface) !important;
  }
  .ac-home-page .ac-home-filter-drawer .ac-filter-dropdown {
    position: static !important;
    inset: auto !important;
    margin-top: 6px !important;
    background: var(--ac-surface-3) !important;
    border: 1px solid var(--ac-border) !important;
    box-shadow: none !important;
  }
  .ac-home-page .ac-home-filter-drawer .relative:has(> .ac-filter-dropdown) { z-index: auto !important; }
  .ac-home-page .ac-home-filter-drawer .ac-filter-control,
  .ac-home-page .ac-home-filter-drawer .ac-search-select {
    min-height: 52px !important;
    height: 52px !important;
    border-radius: 15px !important;
  }
}'''

template = REPO / "apps/web/app/(public)/template.tsx"
text = template.read_text()
anchor = '''@media (max-width: 767px) {
  /* Horizontal rails must not capture the vertical page gesture. Keep native
     horizontal swiping while allowing the page to scroll when the finger
     starts on currencies or brands. */
  .ac-home-page .ac-brand-rail .touch-pan-x,
  .ac-home-page .ac-currency-rates-strip .touch-pan-x {
    touch-action: pan-x pan-y !important;
  }
}
'''
if text.count(anchor) != 1:
    raise SystemExit(f"template mobile CSS anchor: expected one, got {text.count(anchor)}")
template.write_text(text.replace(anchor, anchor + "\n" + home_sheet_css + "\n", 1))

test_path = REPO / "tests/catalog-filter-ui.test.ts"
tests = test_path.read_text()
needle = 'test("the single public catalog search route owns filtered facets and live rates", () => {'
addition = '''test("catalog filters use compact sliders, removable chips and a mobile bottom sheet", () => {
  const source = fs.readFileSync("apps/web/components/catalog/CatalogFilters.tsx", "utf8");
  const page = fs.readFileSync("apps/web/app/(public)/cars/page.tsx", "utf8");
  const storage = fs.readFileSync("apps/web/lib/catalog/storage.ts", "utf8");
  const template = fs.readFileSync("apps/web/app/(public)/template.tsx", "utf8");
  assert.match(source, /ac-dual-range/);
  assert.match(source, /ac-mobile-filter-sheet/);
  assert.match(source, /ac-filter-chip/);
  assert.match(source, /aria-label="Расширенные фильтры"/);
  assert.match(source, /totalRubDesc/);
  assert.match(source, /yearAsc/);
  assert.match(page, /totalRubDesc/);
  assert.match(page, /yearAsc/);
  assert.match(storage, /totalRubDesc/);
  assert.match(storage, /yearAsc/);
  assert.match(template, /ac-home-filter-drawer::before/);
});

'''
if tests.count(needle) != 1:
    raise SystemExit(f"catalog filter test anchor: expected one, got {tests.count(needle)}")
test_path.write_text(tests.replace(needle, addition + needle, 1))
