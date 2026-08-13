from pathlib import Path
import re

ROOT = Path('.')


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')


def once(text, old, new, path):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one occurrence of {old!r}, found {count}')
    return text.replace(old, new, 1)


def regex_once(text, pattern, repl, path, flags=0):
    out, count = re.subn(pattern, repl, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{path}: regex expected once: {pattern!r}, found {count}')
    return out

# 1) Collector: reserve quota independently for every model year.
path = 'scripts/catalog-live-recovery-market.mjs'
s = read(path)
s = once(s,
    'const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");\n',
    'const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");\nconst { CATALOG_MAX_OFFERS_PER_MODEL_YEAR, catalogModelYearQuotaKey } = await import("../apps/web/lib/catalog/inventory-quota.ts");\n', path)
s = regex_once(s, r'const maxOffersPerModel = Math\.max\(1, Math\.min\(100, Number\(process\.env\.CATALOG_MAX_OFFERS_PER_MODEL \|\| 20\)\)\);',
               'const maxOffersPerModelYear = CATALOG_MAX_OFFERS_PER_MODEL_YEAR;', path)
s = regex_once(s,
    r'function modelKey\(offer\) \{\n  const make = String\(offer\?\.make \|\| ""\)\.trim\(\)\.toLowerCase\(\)\.replace\(/\\s\+/g, " "\);\n  const model = String\(offer\?\.model \|\| ""\)\.trim\(\)\.toLowerCase\(\)\.replace\(/\\s\+/g, " "\);\n  return make && model \? `\$\{make\}\|\$\{model\}` : "";\n\}\n', '', path)
s = s.replace('acceptedModelCounts', 'acceptedModelYearCounts')
s = s.replace('pageModelReservations', 'pageModelYearReservations')
s = s.replace('modelKey(offer)', 'catalogModelYearQuotaKey(offer, market)')
s = s.replace('maxOffersPerModel', 'maxOffersPerModelYear')
s = s.replace('"model_quota"', '"model_year_quota"')
write(path, s)

# 2) Recovery publisher: cumulative retention is capped per model + year.
path = 'scripts/catalog-live-recovery-publish.mjs'
s = read(path)
s = once(s,
    'const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");\n',
    'const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");\nconst { CATALOG_MAX_OFFERS_PER_MODEL_YEAR, catalogModelYearQuotaKey, catalogExactModelKey } = await import("../apps/web/lib/catalog/inventory-quota.ts");\n', path)
s = once(s, 'const maxOffersPerModel = 20;\n', 'const maxOffersPerModelYear = CATALOG_MAX_OFFERS_PER_MODEL_YEAR;\n', path)
s = regex_once(s,
    r'function modelKey\(offer\) \{\n  const make = makeKey\(offer\);\n  const model = String\(offer\?\.model \|\| ""\)\.trim\(\)\.toLowerCase\(\)\.replace\(/\\s\+/g, " "\);\n  return make && model \? `\$\{make\}\|\$\{model\}` : "";\n\}\n', '', path)
s = s.replace('applyPerModelCap', 'applyPerModelYearCap')
s = s.replace('modelCounts', 'modelYearCounts')
s = s.replace('modelKey(offer)', 'catalogModelYearQuotaKey(offer, market)')
s = s.replace('maxOffersPerModel', 'maxOffersPerModelYear')
s = s.replace('model_quota', 'model_year_quota')
s = s.replace('distinctModels: diversity.modelYearCounts.size,', 'distinctModels: new Set(marketRows.map((offer) => catalogExactModelKey(offer, market)).filter(Boolean)).size,\n  distinctModelYears: diversity.modelYearCounts.size,')
write(path, s)

# 3) Canonical post-writer cleanup.
path = 'scripts/catalog-enforce-global-model-cap.mjs'
s = read(path)
s = once(s,
    'const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");\n\nconst MAX_OFFERS_PER_MODEL = 20;\n',
    'const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");\nconst { CATALOG_MAX_OFFERS_PER_MODEL_YEAR, catalogModelYearQuotaKey, catalogExactModelKey } = await import("../apps/web/lib/catalog/inventory-quota.ts");\n', path)
s = regex_once(s,
    r'function modelKey\(offer\) \{\n  const make = clean\(offer\?\.make\);\n  const model = clean\(offer\?\.model\);\n  return make && model \? `\$\{make\}\|\$\{model\}` : "";\n\}\n', '', path)
s = s.replace('modelQuota', 'modelYearQuota')
s = s.replace('modelKey(offer)', 'catalogModelYearQuotaKey(offer, market)')
s = s.replace('MAX_OFFERS_PER_MODEL', 'CATALOG_MAX_OFFERS_PER_MODEL_YEAR')
s = s.replace('removedByModelQuota', 'removedByModelYearQuota')
s = s.replace('maxPerExactModel', 'maxPerExactModelYear')
s = s.replace('maxOffersPerModel:', 'maxOffersPerModelYear:')
s = s.replace('`${market}:model_quota:${max}`', '`${market}:model_year_quota:${max}`')
s = s.replace('return { selected, rejected, distinctModels: counts.size, maxPerExactModelYear: counts.size ? Math.max(...counts.values()) : 0 };',
              'return { selected, rejected, distinctModels: new Set(selected.map((offer) => catalogExactModelKey(offer, market)).filter(Boolean)).size, distinctModelYears: counts.size, maxPerExactModelYear: counts.size ? Math.max(...counts.values()) : 0 };')
s = s.replace('distinctModels: result.distinctModels,\n      maxPerExactModelYear:', 'distinctModels: result.distinctModels,\n      distinctModelYears: result.distinctModelYears,\n      maxPerExactModelYear:')
write(path, s)

# 4) Manual strict Japan merge.
path = 'scripts/catalog-japan-strict-merge-publish.mjs'
s = read(path)
s = once(s,
    'const { readVehicleKnowledgeVariants } = await import("../apps/web/lib/catalog/vehicle-knowledge.ts");\n',
    'const { readVehicleKnowledgeVariants } = await import("../apps/web/lib/catalog/vehicle-knowledge.ts");\nconst { CATALOG_MAX_OFFERS_PER_MODEL_YEAR, catalogModelYearQuotaKey, catalogExactModelKey } = await import("../apps/web/lib/catalog/inventory-quota.ts");\n', path)
s = once(s, 'const maxOffersPerModel = 20;\n', 'const maxOffersPerModelYear = CATALOG_MAX_OFFERS_PER_MODEL_YEAR;\n', path)
s = regex_once(s,
    r'function modelKey\(offer\) \{\n  const make = makeKey\(offer\);\n  const model = String\(offer\?\.model \|\| ""\)\.trim\(\)\.toLowerCase\(\)\.replace\(/\\s\+/g, " "\);\n  return make && model \? `\$\{make\}\|\$\{model\}` : "";\n\}\n', '', path)
s = s.replace('modelCounts', 'modelYearCounts')
s = s.replace('modelKey(offer)', 'catalogModelYearQuotaKey(offer, "japan")')
s = s.replace('maxOffersPerModel', 'maxOffersPerModelYear')
s = s.replace('model_quota', 'model_year_quota')
s = s.replace('distinctModels: modelYearCounts.size,', 'distinctModels: new Set(japanRows.map((offer) => catalogExactModelKey(offer, "japan")).filter(Boolean)).size,\n  distinctModelYears: modelYearCounts.size,')
write(path, s)

# 5) Georgia atomic replacement.
path = 'scripts/catalog-replace-georgia-atomic.mjs'
s = read(path)
s = once(s,
    'const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");\n',
    'const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");\nconst { CATALOG_MAX_OFFERS_PER_MODEL_YEAR, catalogModelYearQuotaKey } = await import("../apps/web/lib/catalog/inventory-quota.ts");\n', path)
s = regex_once(s, r'const maxPerModel = Math\.max\(1, Math\.min\(100, Number\(process\.env\.CATALOG_MAX_OFFERS_PER_MODEL \|\| 20\)\)\);',
               'const maxPerModelYear = CATALOG_MAX_OFFERS_PER_MODEL_YEAR;', path)
s = regex_once(s,
    r'function modelKey\(offer\) \{\n  return `\$\{String\(offer\?\.make \|\| ""\)\.trim\(\)\.toLowerCase\(\)\}\|\$\{String\(offer\?\.model \|\| ""\)\.trim\(\)\.toLowerCase\(\)\}`;\n\}\n', '', path)
s = s.replace('modelCounts', 'modelYearCounts')
s = s.replace('modelKey(offer)', 'catalogModelYearQuotaKey(offer, "georgia")')
s = s.replace('maxPerModel', 'maxPerModelYear')
s = s.replace('model_quota', 'model_year_quota')
s = s.replace('acceptedBeforeModelCap', 'acceptedBeforeModelYearCap')
write(path, s)

# 6) Post-persist audit: enforce the new quota and keep total exact-model count informational.
path = 'scripts/catalog-live-postpersist-audit.mjs'
s = read(path)
s = once(s,
    'const { catalogMinYearForMarket } = await import("../apps/web/lib/catalog/offer-quality.ts");\n',
    'const { catalogMinYearForMarket } = await import("../apps/web/lib/catalog/offer-quality.ts");\nconst { CATALOG_MAX_OFFERS_PER_MODEL_YEAR, catalogModelYearQuotaKey, catalogExactModelKey } = await import("../apps/web/lib/catalog/inventory-quota.ts");\n', path)
s = once(s,
    'const maxOffersPerModel = Math.max(1, Number(process.env.CATALOG_AUDIT_MAX_PER_MODEL || 20));\n',
    'const maxOffersPerModelYear = Math.max(1, Number(process.env.CATALOG_AUDIT_MAX_PER_MODEL_YEAR || process.env.CATALOG_AUDIT_MAX_PER_MODEL || CATALOG_MAX_OFFERS_PER_MODEL_YEAR));\n', path)
s = regex_once(s,
    r'function key\(offer\) \{\n  const make = String\(offer\?\.make \|\| ""\)\.trim\(\)\.toLowerCase\(\)\.replace\(/\\s\+/g, " "\);\n  const model = String\(offer\?\.model \|\| ""\)\.trim\(\)\.toLowerCase\(\)\.replace\(/\\s\+/g, " "\);\n  return make && model \? `\$\{String\(offer\?\.market \|\| ""\)\}\|\$\{make\}\|\$\{model\}` : "";\n\}\n', '', path)
s = s.replace('const modelCounts = new Map();\n  for (const offer of rows) { const k = key(offer); if (k) modelCounts.set(k, Number(modelCounts.get(k) || 0) + 1); }',
'''const modelYearCounts = new Map();
  const exactModelCounts = new Map();
  for (const offer of rows) {
    const yearKey = catalogModelYearQuotaKey(offer, market);
    const exactKey = catalogExactModelKey(offer, market);
    if (yearKey) modelYearCounts.set(yearKey, Number(modelYearCounts.get(yearKey) || 0) + 1);
    if (exactKey) exactModelCounts.set(exactKey, Number(exactModelCounts.get(exactKey) || 0) + 1);
  }''')
s = s.replace('distinctModels: modelCounts.size,', 'distinctModels: exactModelCounts.size,\n    distinctModelYears: modelYearCounts.size,')
s = s.replace('maxPerExactModel: modelCounts.size ? Math.max(...modelCounts.values()) : 0,', 'maxPerExactModelAcrossYears: exactModelCounts.size ? Math.max(...exactModelCounts.values()) : 0,\n    maxPerExactModelYear: modelYearCounts.size ? Math.max(...modelYearCounts.values()) : 0,')
s = s.replace('stats.maxPerExactModel > maxOffersPerModel', 'stats.maxPerExactModelYear > maxOffersPerModelYear')
s = s.replace('`${market}:model_quota:${stats.maxPerExactModel}>${maxOffersPerModel}`', '`${market}:model_year_quota:${stats.maxPerExactModelYear}>${maxOffersPerModelYear}`')
write(path, s)

# 7) Workflows: rename only the audit/quota configuration to document semantics.
for wf in (ROOT / '.github/workflows').glob('*.yml'):
    text = wf.read_text(encoding='utf-8')
    text = text.replace('CATALOG_AUDIT_MAX_PER_MODEL:', 'CATALOG_AUDIT_MAX_PER_MODEL_YEAR:')
    text = text.replace('CATALOG_MAX_OFFERS_PER_MODEL:', 'CATALOG_MAX_OFFERS_PER_MODEL_YEAR:')
    text = text.replace('Enforce 20 exact offers per model', 'Enforce 20 exact offers per model-year')
    text = text.replace('global model cap', 'global model-year cap')
    text = text.replace('global model-cap', 'global model-year cap')
    text = text.replace('exact market + make + model quota', 'exact market + make + model + year quota')
    wf.write_text(text, encoding='utf-8')

# 8) Regression test contracts.
path = 'tests/catalog-global-model-cap.test.ts'
s = read(path)
s = s.replace('hard-caps every exact model at twenty', 'hard-caps every exact model-year at twenty')
s = s.replace('/const MAX_OFFERS_PER_MODEL = 20/', '/CATALOG_MAX_OFFERS_PER_MODEL_YEAR/')
s = s.replace('/if \\(count >= MAX_OFFERS_PER_MODEL\\)/', '/if \\(count >= CATALOG_MAX_OFFERS_PER_MODEL_YEAR\\)/')
s = s.replace('CATALOG_AUDIT_MAX_PER_MODEL: "20"', 'CATALOG_AUDIT_MAX_PER_MODEL_YEAR: "20"')
s = s.replace('CATALOG_MAX_OFFERS_PER_MODEL: "20"', 'CATALOG_MAX_OFFERS_PER_MODEL_YEAR: "20"')
s = s.replace('canonical model cap', 'canonical model-year cap')
s = s.replace('canonical model-cap', 'canonical model-year cap')
s = s.replace('model cap', 'model-year cap')
write(path, s)

# Add quota unit coverage into CI without changing unrelated steps.
path = '.github/workflows/ci.yml'
s = read(path)
needle = '      - name: Catalog production hardening tests\n        run: node --import tsx --test tests/catalog-production-hardening.test.ts\n'
insert = needle + '      - name: Catalog model-year inventory quota tests\n        run: node --import tsx --test tests/catalog-model-year-quota.test.ts tests/catalog-global-model-cap.test.ts\n'
s = once(s, needle, insert, path)
write(path, s)

# Safety: production scripts must not keep the old make+model-only quota env.
remaining = []
for base in [ROOT / 'scripts', ROOT / '.github/workflows']:
    for file in base.rglob('*'):
        if not file.is_file() or file.suffix not in {'.mjs', '.mts', '.ts', '.yml', '.yaml'}:
            continue
        text = file.read_text(encoding='utf-8')
        if 'CATALOG_MAX_OFFERS_PER_MODEL' in text and 'CATALOG_MAX_OFFERS_PER_MODEL_YEAR' not in text:
            remaining.append(str(file))
if remaining:
    raise SystemExit('stale model-only quota config remains: ' + ', '.join(remaining))

print('model-year quota patch applied')
