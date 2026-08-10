from pathlib import Path

collector_paths = [
    "scripts/catalog-live-recovery-market.mjs",
    "scripts/catalog-live-recovery-japan-prestige.mjs",
    "scripts/catalog-live-recovery-direct-exact.mjs",
    "scripts/catalog-live-recovery-kyrgyzstan-direct.mjs",
    "scripts/catalog-live-recovery-europe-otomoto.mjs",
]

for path in collector_paths:
    p = Path(path)
    text = p.read_text()
    text = text.replace(
        'const { calculateOfferWithRussiaCustoms } = await import("../apps/web/lib/catalog/customs-pricing.ts");',
        'const { calculateOfferWithRussiaCustoms, isPreliminaryElectrifiedCalculation } = await import("../apps/web/lib/catalog/customs-pricing.ts");',
    )
    text = text.replace(
        'if (!exactCalculation(calculated)) {',
        'if (!exactCalculation(calculated) && !isPreliminaryElectrifiedCalculation(calculated)) {',
    )
    if 'isPreliminaryElectrifiedCalculation' not in text:
        raise SystemExit(f"{path}: preliminary helper missing")
    if 'preliminaryCount:' not in text and 'calculatedCount: offers.filter(exactCalculation).length,' in text:
        text = text.replace(
            '  calculatedCount: offers.filter(exactCalculation).length,\n',
            '  calculatedCount: offers.filter(exactCalculation).length,\n  preliminaryCount: offers.filter(isPreliminaryElectrifiedCalculation).length,\n',
            1,
        )
    if 'recoveryCalculatedRub: true,' in text and 'recoveryPreliminaryPowerPending:' not in text:
        text = text.replace(
            '          recoveryCalculatedRub: true,\n',
            '          recoveryCalculatedRub: true,\n          recoveryPreliminaryPowerPending: isPreliminaryElectrifiedCalculation(calculated),\n',
        )
    p.write_text(text)

print("collector preliminary acceptance hardened")
