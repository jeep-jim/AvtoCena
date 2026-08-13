from pathlib import Path
import re
import subprocess
import sys

root = Path('.')
base = subprocess.run(
    [sys.executable, '.github/patches/apply-model-year-quota-20260813.py'],
    text=True,
    capture_output=True,
)
combined = (base.stdout or '') + (base.stderr or '')
print(combined, end='')
if base.returncode != 0 and 'stale quota config remains:' not in combined:
    raise SystemExit(base.returncode)

# Remove every remaining legacy models-per-make workflow knob. The master
# contract has no make-level model-count quota at all.
for workflow in (root / '.github/workflows').glob('*.yml'):
    text = workflow.read_text(encoding='utf-8')
    text = re.sub(r'^\s*CATALOG_MAX_MODELS_PER_MAKE:\s*[^\n]*\n', '', text, flags=re.M)
    text = text.replace('CATALOG_MAX_OFFERS_PER_MODEL:', 'CATALOG_MAX_OFFERS_PER_MODEL_YEAR:')
    text = text.replace('CATALOG_AUDIT_MAX_PER_MODEL:', 'CATALOG_AUDIT_MAX_PER_MODEL_YEAR:')
    workflow.write_text(text, encoding='utf-8')

# Exhaustive stale-contract scan after all generated edits.
stale = []
for base_dir in [root / 'scripts', root / '.github/workflows']:
    for file in base_dir.rglob('*'):
        if not file.is_file() or file.suffix not in {'.mjs', '.mts', '.ts', '.yml', '.yaml'}:
            continue
        text = file.read_text(encoding='utf-8')
        if re.search(r'CATALOG_MAX_OFFERS_PER_MODEL(?!_YEAR)', text) or 'CATALOG_MAX_MODELS_PER_MAKE' in text:
            stale.append(str(file))
if stale:
    raise SystemExit('stale quota config remains after wrapper: ' + ', '.join(stale))

required = [
    'scripts/catalog-live-recovery-market.mjs',
    'scripts/catalog-live-recovery-publish.mjs',
    'scripts/catalog-enforce-global-model-cap.mjs',
    'scripts/catalog-japan-strict-merge-publish.mjs',
    'scripts/catalog-replace-georgia-atomic.mjs',
    'scripts/catalog-live-postpersist-audit.mjs',
    'scripts/catalog-live-recovery-japan-prestige.mjs',
    'scripts/catalog-live-recovery-europe-otomoto.mjs',
    'scripts/catalog-live-recovery-kyrgyzstan-direct.mjs',
    'scripts/catalog-live-recovery-publish-batch.mjs',
    'scripts/catalog-live-recovery-publish-batch-stable.mjs',
]
for path in required:
    text = Path(path).read_text(encoding='utf-8')
    if 'catalogModelYearQuotaKey' not in text:
        raise SystemExit(f'{path}: missing shared model-year quota key')

print('model-year quota wrapper completed with zero stale quota configs')
