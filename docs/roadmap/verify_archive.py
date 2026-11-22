#!/usr/bin/env python3
"""Verify archived bytes and order without printing historical content."""

from pathlib import Path
import hashlib
import json
import subprocess


ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = Path(__file__).resolve().parent / 'archive' / '2026-11-22'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    manifest = json.loads((ARCHIVE / 'manifest.json').read_text())
    results = []
    for source in manifest['sources']:
        complete = hashlib.sha256()
        total = 0
        for part in source['parts']:
            path = (ARCHIVE / part['path']).resolve()
            if not path.is_relative_to(ARCHIVE.resolve()):
                raise ValueError('Part path escapes archive')
            data = path.read_bytes()
            assert len(data) == part['bytes'], f"Part size mismatch: {part['path']}"
            assert digest(data) == part['sha256'], f"Part hash mismatch: {part['path']}"
            assert len(data) <= manifest['max_part_bytes'], 'Oversized part'
            data.decode('utf-8')
            complete.update(data)
            total += len(data)
        assert total == source['bytes'], f"Source size mismatch: {source['source']}"
        assert complete.hexdigest() == source['sha256'], f"Source hash mismatch: {source['source']}"
        original = subprocess.run(
            ['git', 'show', f"{manifest['source_commit']}:{source['source']}"],
            cwd=ROOT, capture_output=True, check=True,
        ).stdout
        assert digest(original) == complete.hexdigest(), 'Archive differs from original Git blob'
        results.append({'source': source['source'], 'bytes': total,
                        'parts': len(source['parts']), 'sha256': complete.hexdigest()})
    orphan = manifest['uncommitted_worktree']
    data = (ARCHIVE / orphan['path']).read_bytes()
    assert len(data) == orphan['bytes'], 'Orphan patch size mismatch'
    assert digest(data) == orphan['sha256'], 'Orphan patch hash mismatch'
    print(json.dumps({'verified': True, 'sources': results,
                      'orphan_patch_bytes': len(data)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
