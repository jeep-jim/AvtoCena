"""Read-only admission ledger for saved Japanese source packages.

Does not promote collector booleans, infer sold status from a statistics URL,
or fabricate exact engine specifications. No network or production writes.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlparse
import zipfile


def read_rows(location):
    location = Path(location)
    if location.is_dir():
        files = [(str(p.relative_to(location)), p.read_bytes()) for p in sorted(location.rglob('part-*.json'))]
    else:
        with zipfile.ZipFile(location) as archive:
            files = [(n, archive.read(n)) for n in sorted(archive.namelist())
                     if re.fullmatch(r'part-[^/]+\.json', n.split('/')[-1])]
    if not files:
        raise ValueError(f'no_saved_parts:{location}')
    rows, conflicting = {}, set()
    digest = hashlib.sha256()
    for name, data in files:
        digest.update(name.encode() + b'\0' + data)
        for row in json.loads(data):
            key = str(row['sourceId'])
            if key in rows and rows[key] != row:
                conflicting.add(key)
            rows[key] = row
    return list(rows.values()), conflicting, digest.hexdigest()


def norm(value):
    return re.sub(r'[^a-z0-9]', '', str(value or '').lower())


def auction_key(row):
    fields = (row.get('auctionDate'), norm(row.get('auctionName')), str(row.get('lotNumber') or ''))
    return fields if all(fields) else None


def corroborate(row, candidates):
    # A date/auction/lot match alone is only a candidate, never an identity proof.
    exact = [other for other in candidates
             if auction_key(row) is not None and auction_key(row) == auction_key(other)
             and all(norm(row.get(k)) and norm(row.get(k)) == norm(other.get(k))
                    for k in ('make', 'model', 'chassis'))
             and row.get('year') == other.get('year')
             and row.get('priceJpy', 0) > 0 and row.get('priceJpy') == other.get('priceJpy')
             and other.get('source') == 'jptrade'
             and other.get('statusRaw') == 'продано'
             and other.get('sourceUrl') == f"https://jptrade.ru/stat/{other.get('sourceId')}"
             and re.fullmatch(r'[a-f0-9]{64}', str(other.get('evidenceSha256', '')))]
    return exact[0] if len(exact) == 1 else None


def qualify(row, candidates, now, conflicting=False, checked=None):
    source, sid = row.get('source'), str(row.get('sourceId', ''))
    reasons, pending = [], []
    url = urlparse(str(row.get('sourceUrl', '')))
    path_valid = ((source == 'sferacar' and url.hostname == 'sferacar.ru'
                   and url.path.endswith(f'/auc_id={sid}/'))
                  or (source == 'proauctions' and url.hostname == 'demo.pro-auctions.ru'
                      and url.path.startswith('/statistika/') and url.path.endswith(f'/{sid}.html')))
    if not sid.isdigit() or not path_valid or url.scheme != 'https' or url.username or url.password or url.port:
        reasons.append('source_identity_invalid')
    if conflicting:
        reasons.append('conflicting_saved_records')
    if not re.fullmatch(r'[a-f0-9]{64}', str(row.get('evidenceSha256', ''))):
        reasons.append('source_evidence_digest_missing')
    for field in ('make', 'model', 'chassis', 'auctionName', 'lotNumber'):
        if not row.get(field):
            reasons.append(f'{field}_missing')
    year = row.get('year')
    if not isinstance(year, (float, int)) or isinstance(year, bool) or int(year) != year or not 2010 <= year <= now.year:
        reasons.append('year_outside_policy')
    try:
        date = datetime.strptime(row['auctionDate'], '%Y-%m-%d').replace(tzinfo=timezone.utc)
        if not 0 <= (now - date).total_seconds() <= 30 * 86400:
            reasons.append('auction_date_outside_retention')
    except (ValueError, KeyError, TypeError):
        reasons.append('auction_date_invalid')
    price = row.get('priceJpy')
    if not isinstance(price, (float, int)) or isinstance(price, bool) or price <= 0:
        reasons.append('positive_price_missing')
    match = corroborate(row, candidates)
    if not match:
        pending.append('sold_status_and_final_price_unconfirmed')
    # A matching sold lot corroborates the price, not unspecified fuel/engine data.
    fields = row.get('rawFields') or {}
    power_text = fields.get('Мощность ДВС') or fields.get('Мощность') or ''
    hp = re.search(r'(\d+(?:[.,]\d+)?)\s*л\.с', power_text)
    kw = re.search(r'(\d+(?:[.,]\d+)?)\s*кВт', power_text)
    power = None
    if hp:
        power = float(hp[1].replace(',', '.'))
        if kw:
            kw_value = float(kw[1].replace(',', '.'))
            if abs(power - kw_value / 0.73549875) > max(1, power * .02):
                reasons.append('power_hp_kw_conflict')
    else:
        pending.append('power_source_evidence_missing')
    # Preserve raw cc as reported: the archive has no precision/trim evidence
    # permitting rounded auction values to be passed as exact customs input.
    pending.append('engine_and_powertrain_calculation_evidence_unverified')
    if not any(fields.get(k) for k in ('Топливо', 'Тип топлива', 'fuel')) and not row.get('fuel'):
        pending.append('fuel_source_evidence_missing')
    photos = set(row.get('imageUrls') or []) - set(row.get('auctionSheetUrls') or [])
    if len(photos) < 2:
        reasons.append('fewer_than_two_photo_urls')
    decoded = []
    if match and checked and checked.get('sourceId') == str(match['sourceId']) and checked.get('sourceUrl') == match['sourceUrl']:
        decoded = [image for image in checked.get('images', [])
                   if image.get('url') in photos
                   and re.fullmatch(r'[a-f0-9]{64}', str(image.get('decodedSha256', '')))
                   and isinstance(image.get('size'), list) and len(image['size']) == 2
                   and all(isinstance(size, (int, float)) and size >= 100 for size in image['size'])]
    if len(set(image['decodedSha256'] for image in decoded)) < 2:
        pending.append('gallery_decode_verification_pending')
    pending.append('gallery_content_verification_pending')
    return {'source': source, 'sourceId': sid, 'sourceUrl': row.get('sourceUrl'),
            'evidenceSha256': row.get('evidenceSha256'), 'auctionDate': row.get('auctionDate'),
            'priceJpy': price, 'sourcePriceEvidence': row.get('priceEvidence'),
            'reportedEngineCc': row.get('engineCc'), 'powerEvidence': power_text or None,
            'reportedPowerHp': power, 'powerEvidenceKind': 'ice' if fields.get('Мощность ДВС') else 'unspecified', 'photoUrlCount': len(photos), 'decodedPhotoEvidence': decoded,
            'corroboratingSoldLot': ({'sourceUrl': match['sourceUrl'], 'evidenceSha256': match['evidenceSha256']}
                                     if match else None),
            'rejectionReasons': reasons, 'verificationPending': pending,
            'decision': 'rejected' if reasons else 'blocked_pending_evidence',
            'calculationReady': False, 'publicationReady': False}


def main():
    parser = argparse.ArgumentParser()
    for source in ('sferacar', 'proauctions', 'jptrade'):
        parser.add_argument('--' + source, required=True)
    parser.add_argument('--verified-images')
    parser.add_argument('--output', required=True)
    parser.add_argument('--as-of', required=True)
    args = parser.parse_args()
    now = datetime.fromisoformat(args.as_of.replace('Z', '+00:00'))
    if now.tzinfo is None:
        raise ValueError('as_of_timezone_required')
    checks = {}
    if args.verified_images:
        checks = {str(row['sourceId']): row for row in
                  (json.loads(line) for line in Path(args.verified_images).read_text().splitlines() if line.strip())}
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    jp, jp_conflicts, jp_digest = read_rows(args.jptrade)
    idx = defaultdict(list)
    for row in jp:
        key = auction_key(row)
        if key and str(row['sourceId']) not in jp_conflicts:
            idx[key].append(row)
    report = {'checkedAt': now.isoformat(), 'scope': ['sferacar', 'proauctions'],
              'productionWrites': False, 'networkRequests': 0, 'published': 0,
              'corroboratingArchiveSha256': jp_digest, 'sources': {}}
    for source in report['scope']:
        rows, conflicts, digest = read_rows(getattr(args, source))
        if any(row.get('source') != source for row in rows):
            raise ValueError('wrong_source_archive:' + source)
        ledger = []
        for row in rows:
            candidates = idx.get(auction_key(row), [])
            match = corroborate(row, candidates)
            checked = checks.get(str(match['sourceId'])) if match else None
            ledger.append(qualify(row, candidates, now, str(row['sourceId']) in conflicts, checked))
        file = output / (source + '-qualification.jsonl')
        file.write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in ledger))
        counts = Counter(reason for row in ledger for reason in row['rejectionReasons'] + row['verificationPending'])
        report['sources'][source] = {'records': len(rows), 'partsDigestSha256': digest,
           'ledgerSha256': hashlib.sha256(file.read_bytes()).hexdigest(),
           'decisions': dict(Counter(row['decision'] for row in ledger)),
           'corroboratedSoldLots': sum(bool(row['corroboratingSoldLot']) for row in ledger),
           'twoDecodedPhotosCorroborated': sum(len(set(im['decodedSha256'] for im in row['decodedPhotoEvidence'])) >= 2 for row in ledger),
           'calculationReady': 0, 'publicationReady': 0, 'blockerCounts': dict(sorted(counts.items()))}
    (output / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
