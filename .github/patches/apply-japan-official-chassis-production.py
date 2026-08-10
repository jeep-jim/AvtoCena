from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one anchor in {path}, got {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


enrich = "scripts/prestige-japan-official-chassis-enrich.mjs"
replace_once(
    enrich,
    '  const code = frame(offer?.frameNumber || offer?.operational?.raw?.chassis);',
    '  const code = frame(offer?.frameNumber || offer?.operational?.raw?.chassis || offer?.operational?.raw?.fields?.Chassis || offer?.operational?.raw?.fields?.CHASSIS || offer?.operational?.raw?.fields?.chassis);',
)

workflow = ".github/workflows/catalog-live-recovery-japan-from-prestige.yml"
replace_once(
    workflow,
    '          node --check scripts/catalog-live-recovery-japan-prestige.mjs\n          node --check scripts/catalog-live-recovery-publish.mjs',
    '          node --check scripts/prestige-japan-official-chassis-enrich.mjs\n          node --check scripts/catalog-live-recovery-japan-prestige.mjs\n          node --check scripts/catalog-live-recovery-publish.mjs',
)
replace_once(
    workflow,
    '          echo "PRESTIGE_RECOVERY_INPUT=$source_file" >> "$GITHUB_ENV"\n      - name: Convert strict sold lots into exact calculated ruble cards',
    '''          echo "PRESTIGE_RECOVERY_INPUT=$source_file" >> "$GITHUB_ENV"\n      - name: Enrich strict sold lots with exact manufacturer chassis power\n        shell: bash\n        run: |\n          set -euo pipefail\n          export PRESTIGE_OFFICIAL_INPUT="$PRESTIGE_RECOVERY_INPUT"\n          export PRESTIGE_OFFICIAL_OUTPUT="prestige-japan-exact-sold-official-power.json"\n          node scripts/prestige-japan-official-chassis-enrich.mjs\n          test -s "$PRESTIGE_OFFICIAL_OUTPUT"\n          echo "PRESTIGE_RECOVERY_INPUT=$PRESTIGE_OFFICIAL_OUTPUT" >> "$GITHUB_ENV"\n      - name: Convert strict sold lots into exact calculated ruble cards''',
)
replace_once(
    workflow,
    '          path: |\n            catalog-rebuild-japan.json\n            catalog-live-recovery-japan-publish-report.json',
    '          path: |\n            prestige-japan-exact-sold-official-power.json\n            catalog-rebuild-japan.json\n            catalog-live-recovery-japan-publish-report.json',
)
