"""Select at most ten distinct listings per source from existing artifacts.

No network, catalog writes, or claims that source values have been verified.
Input: directories produced by actions/download-artifact, including Japan.
Latest detail revision wins. Stable hash order and make/fuel diversity make
the sample reproducible; this is a diagnostic sample, not a population estimate.
"""
import collections
import hashlib
import json
import pathlib
import sys


def select(rows, limit=10):
    rows = sorted(rows, key=lambda r: hashlib.sha256(str(r.get('offer', r).get('sourceOfferId', r.get('sourceId'))).encode()).hexdigest())
    result, identities = [], set()
    for row in rows:
        offer = row.get('offer', row)
        identity = (offer.get('make'), offer.get('fuel'), offer.get('powertrainKind'))
        if identity not in identities:
            result.append(row)
            identities.add(identity)
        if len(result) == limit:
            break
    for row in rows:
        if len(result) >= limit:
            break
        if row not in result:
            result.append(row)
    return result


def main(root, output):
    output.mkdir(parents=True, exist_ok=True)
    grouped, reports, summaries = collections.defaultdict(dict), [], {}
    for file in sorted(root.rglob('*.jsonl')):
        for line in file.open():
            row = json.loads(line)
            offer = row.get('offer', {})
            source, identity = offer.get('sourceId'), offer.get('sourceOfferId')
            if not source or not identity:
                continue
            if identity not in grouped[source] or row.get('stage') == 'detail':
                grouped[source][identity] = row
    for file in sorted(root.rglob('part-*.json')):
        for row in json.loads(file.read_text()):
            if row.get('source') in ('jptrade', 'sferacar', 'proauctions'):
                grouped[row['source']][row['sourceId']] = row
    for file in root.rglob('report.json'):
        report = json.loads(file.read_text())
        for source in report.get('sources', []):
            reports.append(source)
    for source, records in sorted(grouped.items()):
        rows = select(list(records.values()))
        (output / f'{source}.json').write_text(json.dumps(rows, ensure_ascii=False))
        summaries[source] = {'uniqueSaved': len(records), 'sampleCount': len(rows), 'sampleComplete': len(rows) == 10}
    for source in reports:
        summary = summaries.setdefault(source['sourceId'], {'uniqueSaved': 0, 'sampleCount': 0, 'sampleComplete': False})
        summary.update(stopReason=source.get('stopReason'), errors=source.get('errors', [])[:3])
    (output / 'manifest.json').write_text(json.dumps(summaries, ensure_ascii=False, indent=2))
    print(json.dumps(summaries, ensure_ascii=False))


if __name__ == '__main__':
    main(pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]))
