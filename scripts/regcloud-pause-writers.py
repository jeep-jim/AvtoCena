"""Temporarily disable GitHub workflows using legacy storage; save exact prior state."""
import json
import os
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def writer_paths(root):
    files = {'.github/workflows/' + p.name: p.read_text() for p in (root / '.github/workflows').glob('*.y*ml')}
    candidates = {p for p, text in files.items() if not Path(p).name.startswith('regcloud-') and ('YC_OBJECT_STORAGE' in text or 'YC_SA_JSON_CREDENTIALS' in text)}
    while True:
        parents = {p for p, text in files.items() if not Path(p).name.startswith('regcloud-') and any('./' + child in text for child in candidates)}
        if parents <= candidates:
            return candidates
        candidates |= parents

def main():
    repo = os.environ['GITHUB_REPOSITORY']
    if repo != 'jeep-jim/AvtoCena' or os.environ['GITHUB_REF'] != 'refs/heads/main':
        raise RuntimeError('Unexpected repository/ref')
    def api(path, method='GET'):
        request = urllib.request.Request('https://api.github.com/repos/' + repo + path, method=method,
            headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'})
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read()
            return json.loads(body) if body else None
    def pages(path, field):
        result = []
        for page in range(1, 101):
            rows = api(path + ('&' if '?' in path else '?') + f'per_page=100&page={page}')[field]
            result.extend(rows)
            if len(rows) < 100:
                return result
        raise RuntimeError('Incomplete pagination')
    paths = writer_paths(ROOT)
    workflows = [w for w in pages('/actions/workflows', 'workflows') if w['path'] in paths]
    snapshot = {'runId': os.environ['GITHUB_RUN_ID'], 'workflows': [{'id': w['id'], 'path': w['path'], 'state': w['state']} for w in workflows], 'disabled': [], 'cancelledRuns': []}
    destination = Path('regcloud-paused-workflows.json')
    def save():
        destination.write_text(json.dumps(snapshot, indent=2))
    save()
    for workflow in workflows:
        if workflow['state'] == 'active':
            api(f"/actions/workflows/{workflow['id']}/disable", 'PUT')
            snapshot['disabled'].append(workflow['id'])
            save()
    ids = {w['id'] for w in workflows}
    for attempt in range(60):
        active = []
        for status in ['in_progress', 'queued', 'waiting', 'pending', 'requested']:
            active.extend(r for r in pages('/actions/runs?status=' + status, 'workflow_runs') if r['workflow_id'] in ids and str(r['id']) != os.environ['GITHUB_RUN_ID'])
        if not active:
            current = {w['id']: w['state'] for w in pages('/actions/workflows', 'workflows')}
            if any(current.get(w['id']) == 'active' for w in workflows):
                raise RuntimeError('A legacy writer was re-enabled')
            print(json.dumps({'pausedWorkflows': len(snapshot['disabled']), 'activeLegacyRuns': 0, 'externalWritersFrozen': False}))
            return
        for run in {r['id']: r for r in active}.values():
            if run['id'] not in snapshot['cancelledRuns']:
                api(f"/actions/runs/{run['id']}/cancel", 'POST')
                snapshot['cancelledRuns'].append(run['id'])
                save()
        time.sleep(10)
    raise RuntimeError('Legacy jobs did not stop; copying refused')

if __name__ == '__main__':
    main()
