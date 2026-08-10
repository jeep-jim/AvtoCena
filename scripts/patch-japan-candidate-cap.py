from pathlib import Path

p = Path('scripts/catalog-live-recovery-japan-prestige.mjs')
s = p.read_text()

old = '''const maxOffersPerModel = Math.max(1, Math.min(100, Number(process.env.CATALOG_MAX_OFFERS_PER_MODEL || 20)));\nconst concurrency = Math.max(1, Math.min(16, Number(process.env.PRESTIGE_RECOVERY_CONCURRENCY || 12)));'''
new = '''const maxOffersPerModel = Math.max(1, Math.min(100, Number(process.env.CATALOG_MAX_OFFERS_PER_MODEL || 20)));\nconst candidateMaxOffersPerModel = Math.max(maxOffersPerModel, Math.min(100, Number(process.env.PRESTIGE_RECOVERY_CANDIDATE_PER_MODEL || maxOffersPerModel * 4)));\nconst concurrency = Math.max(1, Math.min(16, Number(process.env.PRESTIGE_RECOVERY_CONCURRENCY || 12)));'''
if old not in s:
    raise SystemExit('constants marker not found')
s = s.replace(old, new, 1)

old = '''function takeWithPerModelCap(rows, limit) {\n  const counts = new Map();'''
new = '''function takeWithPerModelCap(rows, limit, perModelCap = maxOffersPerModel) {\n  const counts = new Map();'''
if old not in s:
    raise SystemExit('cap function marker not found')
s = s.replace(old, new, 1)
s = s.replace('if (key && count >= maxOffersPerModel) { quotaSkipped++; continue; }', 'if (key && count >= perModelCap) { quotaSkipped++; continue; }', 1)

old = 'const candidateSelection = takeWithPerModelCap(eligibleRows, Math.max(target * 8, target));'
new = 'const candidateSelection = takeWithPerModelCap(eligibleRows, Math.max(target * 8, target), candidateMaxOffersPerModel);'
if old not in s:
    raise SystemExit('candidate selection marker not found')
s = s.replace(old, new, 1)

old = '''  maxOffersPerModel,\n  preliminaryCount:'''
new = '''  maxOffersPerModel,\n  candidateMaxOffersPerModel,\n  preliminaryCount:'''
if old not in s:
    raise SystemExit('report marker not found')
s = s.replace(old, new, 1)

p.write_text(s)
print('japan_candidate_cap_patch_ok')
