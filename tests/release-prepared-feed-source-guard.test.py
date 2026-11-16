import copy
import hashlib
import re
import types
import json
from pathlib import Path
import unittest
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
workflow = (ROOT / '.github/workflows/release-prepared-feed-delivery.yml').read_text()
match = re.search(r"cat > \"\$RUNNER_TEMP/verify-history-candidate.py\" <<'(FASTPATH_HELPER_[A-F0-9]+)'\n", workflow)
assert match, 'reviewed source guard must be embedded in the release controller'
end = workflow.index('\n        ' + match.group(1) + '\n', match.end())
source = '\n'.join(line.removeprefix('        ') for line in workflow[match.end():end].splitlines()) + '\n'
guard = types.ModuleType('reviewed_source_guard')
exec(compile(source, '<reviewed_source_guard>', 'exec'), guard.__dict__)


class GuardTests(unittest.TestCase):
    def fixture(self):
        candidate = json.loads((ROOT / 'docs/operations/prepared-feed-delivery-candidate.json').read_text())
        rows = [dict(id=i + 1, name=name, head_sha=candidate['source'], status='completed', conclusion='success')
                for i, name in enumerate(sorted(guard.REQUIRED))]
        values = {
            'commits/' + candidate['source']: {'sha': candidate['source'], 'commit': {'tree': {'sha': candidate['tree']}}},
            'pulls/' + str(candidate['pr']): {'state': 'open', 'draft': True, 'head': {'sha': candidate['source']}, 'base': {'sha': guard.RETAINED}},
            'actions/runs?head_sha=' + candidate['source'] + '&per_page=100': {'total_count': len(rows), 'workflow_runs': rows},
        }
        health = {'ok': True, 'releaseSha': guard.RETAINED, 'calculationVersion': guard.RETAINED_CALCULATOR}
        return candidate, values, health

    def test_all_thirteen_exact_source_checks_are_mandatory(self):
        candidate, values, health = self.fixture()
        report = guard.verify_candidate(candidate, values.__getitem__, lambda: health)
        self.assertEqual(report['checks'], 13)
        self.assertEqual(report['calculationVersion'], candidate['calculationVersion'])
        for missing in guard.REQUIRED:
            candidate, values, health = self.fixture()
            runs = values['actions/runs?head_sha=' + candidate['source'] + '&per_page=100']
            runs['workflow_runs'] = [r for r in runs['workflow_runs'] if r['name'] != missing]
            runs['total_count'] -= 1
            with self.assertRaisesRegex(AssertionError, 'source_checks_wait_deadline'):
                guard.verify_candidate(candidate, values.__getitem__, lambda: health, clock=lambda: 1, wait_seconds=0)

    def test_no_failed_or_cancelled_extra_exact_head_run_is_ignored(self):
        for conclusion in ('failure', 'cancelled', 'skipped', 'timed_out'):
            candidate, values, health = self.fixture()
            runs = values['actions/runs?head_sha=' + candidate['source'] + '&per_page=100']
            runs['workflow_runs'].append(dict(id=99, name='Extra check', head_sha=candidate['source'], status='completed', conclusion=conclusion))
            runs['total_count'] += 1
            with self.assertRaisesRegex(AssertionError, 'exact_source_check_failed:99'):
                guard.verify_candidate(candidate, values.__getitem__, lambda: health)

    def test_changed_identity_or_newly_installed_insurance_release_stops_activation(self):
        for failure in ('health', 'calculator', 'tree', 'base', 'head'):
            candidate, values, health = self.fixture()
            if failure == 'health': health['releaseSha'] = guard.INSURANCE_SOURCE
            if failure == 'calculator': health['calculationVersion'] = candidate['calculationVersion']
            if failure == 'tree': values['commits/' + candidate['source']]['commit']['tree']['sha'] = 'c' * 40
            if failure == 'base': values['pulls/' + str(candidate['pr'])]['base']['sha'] = guard.INSURANCE_SOURCE
            if failure == 'head': values['pulls/' + str(candidate['pr'])]['head']['sha'] = 'c' * 40
            with self.assertRaises(AssertionError):
                guard.verify_candidate(candidate, values.__getitem__, lambda: health)

    def test_only_reviewed_runtime_libraries_and_two_writer_scripts_are_allowed(self):
        for path in ('apps/web/lib/catalog/rates.ts', 'scripts/catalog-calculation-version.mjs', 'data/knowledge/index.json',
                     'packages/engine/index.ts', '.github/workflows/deploy-yandex.yml', 'tests/../scripts/change.mjs'):
            candidate, _, _ = self.fixture(); candidate['allowedPaths'].append(path)
            with self.assertRaises(AssertionError): guard.validate_spec(candidate)
        candidate, _, _ = self.fixture(); candidate['requiredChecks'].remove('Verify offer sharing')
        with self.assertRaisesRegex(AssertionError, 'required_source_checks_changed'): guard.validate_spec(candidate)
        candidate, _, _ = self.fixture(); candidate['calculationVersion'] = guard.RETAINED_CALCULATOR
        with self.assertRaisesRegex(AssertionError, 'candidate_requires_new_calculator'): guard.validate_spec(candidate)

    def test_source_move_while_waiting_is_rejected(self):
        candidate, values, health = self.fixture()
        values['actions/runs?head_sha=' + candidate['source'] + '&per_page=100']['workflow_runs'][0]['status'] = 'in_progress'
        def change(_): values['pulls/' + str(candidate['pr'])]['head']['sha'] = 'd' * 40
        with self.assertRaisesRegex(AssertionError, 'candidate_pr_changed'):
            guard.verify_candidate(candidate, values.__getitem__, lambda: health, pause=change)

    def local(self):
        candidate, _, _ = self.fixture()
        records = '100644 blob ' + 'a' * 40 + '\tapps/web/lib/encyclopedia/calculation-index.ts\0'
        candidate['encyclopediaCompatibilityDigest'] = hashlib.sha256(('avtocena-encyclopedia-content-v1\0' + records.rstrip('\0')).encode()).hexdigest()
        state = {'records': records, 'candidateRecords': records, 'paths': candidate['allowedPaths'], 'extra': candidate['supplementPaths']}
        def git(args):
            if args == ['rev-parse', 'HEAD']: return candidate['source']
            if args == ['rev-parse', 'HEAD^{tree}']: return candidate['tree']
            if args[:2] == ['merge-base', '--is-ancestor']: return ''
            if args[:2] == ['diff', '--name-only']: return '\n'.join(state['paths'] if args[2] == guard.RETAINED else state['extra'])
            if args[:3] == ['ls-tree', '-rz', '--full-tree']:
                self.assertEqual(tuple(args[5:]), guard.COMPATIBILITY_PATHS)
                return state['records'] if args[3] == guard.RETAINED else state['candidateRecords']
            raise AssertionError('unexpected git operation')
        return candidate, state, git

    def test_local_compatibility_requires_same_content_closure_and_real_new_calculator(self):
        candidate, state, git = self.local()
        proof = guard.verify_local_source(candidate, git, candidate['calculationVersion'])
        self.assertEqual(proof['files'], 1)
        self.assertTrue(proof['unchanged'])
        self.assertEqual(proof['calculationVersion'], candidate['calculationVersion'])
        with self.assertRaisesRegex(AssertionError, 'candidate_calculator_mismatch'):
            guard.verify_local_source(candidate, git, guard.RETAINED_CALCULATOR)
        state['candidateRecords'] = state['records'].replace('a' * 40, 'b' * 40)
        with self.assertRaisesRegex(AssertionError, 'encyclopedia_compiler_or_schema_changed'):
            guard.verify_local_source(candidate, git, candidate['calculationVersion'])

    def test_scope_and_compatibility_pins_cannot_be_substituted(self):
        for change in ('fullDiff', 'supplementDiff', 'closurePin', 'missingClosure'):
            candidate, state, git = self.local()
            if change == 'fullDiff': state['paths'] = state['paths'] + ['unreviewed.txt']
            if change == 'supplementDiff': state['extra'] = state['extra'][:-1]
            if change == 'closurePin': candidate['encyclopediaCompatibilityDigest'] = 'f' * 64
            if change == 'missingClosure': state['records'] = state['candidateRecords'] = ''
            with self.assertRaises(AssertionError): guard.verify_local_source(candidate, git, candidate['calculationVersion'])

    def health_fixture(self, outcomes):
        state = {'calls': 0, 'pauses': [], 'reports': []}
        class Response:
            status = 200
            def __init__(self, value): self.value = value
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, size):
                self.assert_size = size
                return self.value
        def open_health(request, timeout):
            self.assertEqual(request.full_url, 'https://avtocena.com/api/health')
            self.assertEqual(timeout, 45)
            self.assertEqual(request.get_method(), 'GET')
            outcome = outcomes[state['calls']]
            state['calls'] += 1
            if isinstance(outcome, BaseException): raise outcome
            return Response(outcome)
        def run():
            return guard.read_retained_health(open_health, state['pauses'].append, lambda: 1,
                                              lambda value, **_: state['reports'].append(json.loads(value)))
        return state, run

    def test_health_transport_retry_is_bounded_and_records_each_failed_attempt(self):
        for error in (TimeoutError(), ConnectionResetError(), urllib.error.URLError(TimeoutError()),
                      urllib.error.HTTPError('https://avtocena.com/api/health', 503, '', {}, None)):
            state, run = self.health_fixture([error, b'{"ok":true}'])
            self.assertEqual(run(), {'ok': True})
            self.assertEqual(state['calls'], 2)
            self.assertEqual(state['pauses'], [2])
            self.assertTrue(state['reports'][0]['willRetry'])
            self.assertEqual(state['reports'][1]['http'], 200)
        state, run = self.health_fixture([TimeoutError(), TimeoutError(), TimeoutError()])
        with self.assertRaises(TimeoutError): run()
        self.assertEqual(state['calls'], 3)
        self.assertEqual(state['pauses'], [2, 4])
        self.assertFalse(state['reports'][-1]['willRetry'])

    def test_health_refusal_invalid_content_and_changed_identity_are_never_retried(self):
        for error in (urllib.error.HTTPError('https://avtocena.com/api/health', 403, '', {}, None),
                      urllib.error.HTTPError('https://avtocena.com/api/health', 429, '', {}, None),
                      urllib.error.URLError('certificate verification failed'), b'not-json', b'x' * 32769):
            state, run = self.health_fixture([error])
            with self.assertRaises(Exception): run()
            self.assertEqual(state['calls'], 1)
            self.assertEqual(state['pauses'], [])
        candidate, values, health = self.fixture()
        health['releaseSha'] = guard.INSURANCE_SOURCE
        state, run = self.health_fixture([json.dumps(health).encode()])
        with self.assertRaisesRegex(AssertionError, 'retained_release_changed'):
            guard.verify_candidate(candidate, values.__getitem__, run)
        self.assertEqual(state['calls'], 1)


if __name__ == '__main__': unittest.main()
