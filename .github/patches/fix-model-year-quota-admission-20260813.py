from pathlib import Path

path = Path('scripts/catalog-live-recovery-market.mjs')
s = path.read_text(encoding='utf-8')

def once(old, new):
    global s
    count = s.count(old)
    if count != 1:
        raise SystemExit(f'expected one occurrence, got {count}: {old[:120]!r}')
    s = s.replace(old, new, 1)

once('    const pageModelYearReservations = new Map();\n\n', '')
once('''      if (!detailBoundIdentity) {
        const quotaKey = catalogModelYearQuotaKey(offer, market);
        const acceptedForModel = quotaKey ? Number(acceptedModelYearCounts.get(quotaKey) || 0) : 0;
        const reservedForModel = quotaKey ? Number(pageModelYearReservations.get(quotaKey) || 0) : 0;
        if (quotaKey && acceptedForModel + reservedForModel >= maxOffersPerModelYear) { reject(rejections, "model_year_quota"); return null; }
        if (quotaKey) pageModelYearReservations.set(quotaKey, reservedForModel + 1);
      }
''', '')
once('''        const quotaKey = catalogModelYearQuotaKey(offer, market);
        const acceptedForModel = quotaKey ? Number(acceptedModelYearCounts.get(quotaKey) || 0) : 0;
        const reservedForModel = quotaKey ? Number(pageModelYearReservations.get(quotaKey) || 0) : 0;
        if (quotaKey && acceptedForModel + reservedForModel >= maxOffersPerModelYear) { reject(rejections, "model_year_quota"); return null; }
        if (quotaKey) pageModelYearReservations.set(quotaKey, reservedForModel + 1);
''', '')
once('''    for (const offer of prepared.filter(Boolean)) {
    if (!accepted.has(offer.id)) {
      accepted.set(offer.id, offer);
      const key = catalogModelYearQuotaKey(offer, market);
      if (key) acceptedModelYearCounts.set(key, Number(acceptedModelYearCounts.get(key) || 0) + 1);
    }
    if (!globalOffers.has(offer.id)) globalOffers.set(offer.id, offer);
  }
''', '''    for (const offer of prepared.filter(Boolean)) {
      if (accepted.has(offer.id)) {
        if (!globalOffers.has(offer.id)) globalOffers.set(offer.id, offer);
        continue;
      }
      const key = catalogModelYearQuotaKey(offer, market);
      const acceptedForModelYear = key ? Number(acceptedModelYearCounts.get(key) || 0) : 0;
      if (key && acceptedForModelYear >= maxOffersPerModelYear) {
        reject(rejections, "model_year_quota");
        continue;
      }
      accepted.set(offer.id, offer);
      if (key) acceptedModelYearCounts.set(key, acceptedForModelYear + 1);
      if (!globalOffers.has(offer.id)) globalOffers.set(offer.id, offer);
    }
''')
if 'pageModelYearReservations' in s:
    raise SystemExit('stale page reservation remains')
path.write_text(s, encoding='utf-8')
print('post-success model-year quota admission patched')
