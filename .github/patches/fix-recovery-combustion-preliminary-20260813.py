from pathlib import Path

p = Path('scripts/catalog-live-recovery-market.mjs')
s = p.read_text()
repls = [
    (
        'const { calculateOfferWithRussiaCustoms, isPreliminaryElectrifiedCalculation } = await import("../apps/web/lib/catalog/customs-pricing.ts");',
        'const { calculateOfferWithPreliminaryPowerPricing, isPreliminaryPowerPendingCalculation } = await import("../apps/web/lib/catalog/customs-pricing.ts");'
    ),
    (
        'try { calculated = normalizeVehicleOfferSpecs(await calculateOfferWithRussiaCustoms(offer)); }',
        'try { calculated = normalizeVehicleOfferSpecs(await calculateOfferWithPreliminaryPowerPricing(offer)); }'
    ),
    (
        'if (!exactCalculation(calculated) && !isPreliminaryElectrifiedCalculation(calculated)) {',
        'if (!exactCalculation(calculated) && !isPreliminaryPowerPendingCalculation(calculated)) {'
    ),
    (
        'recoveryPreliminaryPowerPending: isPreliminaryElectrifiedCalculation(calculated),',
        'recoveryPreliminaryPowerPending: isPreliminaryPowerPendingCalculation(calculated),'
    ),
    (
        'preliminaryCount: offers.filter(isPreliminaryElectrifiedCalculation).length,',
        'preliminaryCount: offers.filter(isPreliminaryPowerPendingCalculation).length,'
    ),
]
for old, new in repls:
    if s.count(old) != 1:
        raise SystemExit(f'expected exactly one occurrence: {old}')
    s = s.replace(old, new, 1)
p.write_text(s)

t = Path('tests/catalog-model-year-quota.test.ts')
ts = t.read_text()
marker = '''test("daily and legacy recovery workflows expose only model-year quota and canonical Georgia sources", () => {'''
if marker not in ts:
    raise SystemExit('test insertion marker missing')
block = '''test("generic recovery retains source-bound combustion offers as explicit preliminary power-pending instead of dropping them", () => {\n  const source = fs.readFileSync("scripts/catalog-live-recovery-market.mjs", "utf8");\n  assert.match(source, /calculateOfferWithPreliminaryPowerPricing/);\n  assert.match(source, /isPreliminaryPowerPendingCalculation/);\n  assert.doesNotMatch(source, /isPreliminaryElectrifiedCalculation/);\n  assert.match(source, /recoveryPreliminaryPowerPending:\s*isPreliminaryPowerPendingCalculation/);\n  assert.match(source, /preliminaryCount:\s*offers\.filter\(isPreliminaryPowerPendingCalculation\)/);\n});\n\n'''
if block not in ts:
    ts = ts.replace(marker, block + marker, 1)
t.write_text(ts)
