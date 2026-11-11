import contextlib, importlib.util, io, json, os, pathlib, subprocess, tempfile, textwrap, time, unittest
from unittest.mock import MagicMock, patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('public_pages', ROOT/'scripts/public-page-latency.py')
probe = importlib.util.module_from_spec(spec); spec.loader.exec_module(probe)
RELEASE = 'a'*40
BASE = 'http://127.0.0.1:3000'
PAGES = {
 '/privacy': '<html><h1>Политика обработки персональных данных</h1><h2>Общие положения</h2><a href="/privacy/request">Обращение</a></html>',
 '/blog': '<html><h1>Автоблог</h1><a href="/blog/verified-post">Статья</a></html>',
 '/dealers': '<html><h1>Автодилеры</h1><p role="status">Компаний: <!-- -->1</p><a class="dealer-directory-card" href="/nvkz/topavto">Компания</a></html>',
}

def fixture():
    calls, sleeps = [], []
    clock = [0.0]
    def fetch(base, path, deadline):
        calls.append(path); clock[0] += .1
        body = json.dumps({'ok':True,'releaseSha':RELEASE}).encode() if path == '/api/health' else PAGES[path].encode()
        return 200, body, .02, .1
    def sleep(seconds): sleeps.append(seconds); clock[0] += seconds
    return calls, sleeps, clock, fetch, sleep

class ObservationTests(unittest.TestCase):
    def test_exact_three_routes_and_four_observation_phases_without_cache_or_speed_claims(self):
        calls, sleeps, clock, fetch, sleep = fixture()
        result = probe.collect(BASE, RELEASE, fetch, lambda:clock[0], sleep)
        self.assertTrue(result['functionalPassed']); self.assertEqual(len(result['samples']),12)
        self.assertEqual(calls,['/api/health']+list(probe.ROUTES)*4+['/api/health'])
        self.assertEqual([row['phase'] for row in result['samples']],[phase for phase,_ in probe.PHASES for _ in probe.ROUTES])
        self.assertAlmostEqual(sum(sleeps),100); self.assertLessEqual(max(sleeps),30)
        self.assertFalse(result['firstObservationIsColdProof']); self.assertFalse(result['waitsProveCacheExpiry'])
        self.assertFalse(result['performanceCeilingsApplied'])
        self.assertEqual(result['healthBefore'],result['healthAfter'])
        self.assertNotIn('Статья',json.dumps(result,ensure_ascii=False))
    def test_wrong_initial_release_fails_before_any_page(self):
        calls, sleeps, clock, fetch, sleep = fixture()
        result = probe.collect(BASE,'b'*40,fetch,lambda:clock[0],sleep)
        self.assertFalse(result['functionalPassed']); self.assertEqual(calls,['/api/health'])
        self.assertEqual(result['errorCode'],'release_mismatch')
    def test_changed_final_release_invalidates_otherwise_complete_observations(self):
        calls, sleeps, clock, fetch, sleep = fixture()
        def changed(base,path,deadline):
            result=fetch(base,path,deadline)
            if path=='/api/health' and calls.count(path)==2:
                return 200,json.dumps({'ok':True,'releaseSha':'b'*40}).encode(),.02,.1
            return result
        result=probe.collect(BASE,RELEASE,changed,lambda:clock[0],sleep)
        self.assertFalse(result['functionalPassed']);self.assertEqual(result['healthAfterError'],'release_mismatch')
        self.assertEqual(len(result['samples']),12)
    def test_functional_failure_stops_page_requests_but_checks_final_identity(self):
        calls, sleeps, clock, fetch, sleep = fixture()
        def failed(base,path,deadline):
            status,body,first,complete=fetch(base,path,deadline)
            return status,b'<html>private error fragment' if path=='/privacy' else body,first,complete
        result=probe.collect(BASE,RELEASE,failed,lambda:clock[0],sleep)
        self.assertEqual(calls,['/api/health','/privacy','/api/health'])
        self.assertFalse(result['functionalPassed']);self.assertEqual(result['errorCode'],'incomplete_html')
        self.assertNotIn('private error',json.dumps(result));self.assertTrue(result['healthAfter']['ok'])
    def test_interruption_does_not_continue_with_more_network_work(self):
        calls, sleeps, clock, fetch, _ = fixture()
        def stop(_): raise probe.DiagnosticFailure('interrupted')
        result=probe.collect(BASE,RELEASE,fetch,lambda:clock[0],stop)
        self.assertEqual(result['errorCode'],'interrupted');self.assertEqual(calls.count('/api/health'),1)
        self.assertEqual(len(result['samples']),6)
    def test_expected_calculation_is_verified_before_pages_and_after_observations(self):
        expected='c'*64
        for wrong_at in [None,1,2]:
            calls,sleeps,clock,fetch,sleep=fixture()
            def checked(base,path,deadline):
                result=fetch(base,path,deadline)
                if path=='/api/health':
                    value=json.loads(result[1]);value['calculationVersion']='d'*64 if calls.count(path)==wrong_at else expected
                    return result[0],json.dumps(value).encode(),result[2],result[3]
                return result
            result=probe.collect(BASE,RELEASE,checked,lambda:clock[0],sleep,calculation_version=expected)
            self.assertEqual(result['functionalPassed'],wrong_at is None)
            if wrong_at==1:self.assertEqual(calls,['/api/health'])
            if wrong_at==2:self.assertEqual(result['healthAfterError'],'calculation_version_mismatch')
    def test_scope_is_loopback_existing_ports_only(self):
        for base in ['https://avtocena.com','http://example.test:3000','http://127.0.0.1:9000']:
            with self.assertRaisesRegex(probe.DiagnosticFailure,'invalid_scope'):probe.collect(base,RELEASE)

class ContentTests(unittest.TestCase):
    def test_real_page_families_require_complete_distinct_content(self):
        for path,body in PAGES.items():self.assertIsInstance(probe.validate_page(path,200,body.encode()),dict)
        cases=[('/privacy',200,b'</html>'),('/blog',500,PAGES['/blog'].encode()),
               ('/blog',200,PAGES['/blog'].replace('</html>','$RX(</html>').encode()),
               ('/dealers',200,PAGES['/dealers'].replace('1</p>','2</p>').encode()),
               ('/blog',200,b'<html><h1>other</h1></html>')]
        for args in cases:
            with self.assertRaises(probe.DiagnosticFailure):probe.validate_page(*args)
    def test_fake_closing_markup_and_hidden_empty_state_are_not_completion(self):
        for path in ['/blog','/privacy']:
            source=PAGES[path].removesuffix('</html>')
            for suffix in ['<!-- </html> -->','<script>const x="</html>";']:
                with self.assertRaisesRegex(probe.DiagnosticFailure,'incomplete_html'):
                    probe.validate_page(path,200,(source+suffix).encode())
        for suffix in ['<script>stream(', '<!-- unfinished', '<template>pending', '<scr']:
            with self.assertRaisesRegex(probe.DiagnosticFailure,'incomplete_html'):
                probe.validate_page('/blog',200,(PAGES['/blog']+suffix).encode())
        for tag in ['script','template','style']:
            body=f'<html><h1>Автоблог</h1><p>Ошибка</p><{tag}>Первые материалы готовятся к публикации.</{tag}></html>'
            with self.assertRaisesRegex(probe.DiagnosticFailure,'blog_content_missing'):
                probe.validate_page('/blog',200,body.encode())
    def test_void_elements_do_not_corrupt_visible_dealer_status(self):
        for void in ['<br>','<br/>','<img src="ignored">','<img src="ignored"/>']:
            body=PAGES['/dealers'].replace('<!-- -->',void)
            self.assertEqual(probe.validate_page('/dealers',200,body.encode()),{'dealerCards':1})
    def test_loopback_opener_does_not_read_environment_proxies(self):
        with patch.object(probe.urllib.request,'getproxies',side_effect=AssertionError('environment proxies forbidden')):
            spec.loader.exec_module(probe)
    def test_truthful_empty_dealer_and_blog_pages_are_supported(self):
        self.assertEqual(probe.validate_page('/dealers',200,'<h1>Автодилеры</h1><p role="status">Компаний: 0</p></html>'.encode()),{'dealerCards':0})
        self.assertEqual(probe.validate_page('/blog',200,'<h1>Автоблог</h1>Первые материалы готовятся к публикации.</html>'.encode()),{'articleLinks':0})
    def test_body_cap_closes_response_and_clears_deadline_without_retry(self):
        response=MagicMock();response.__enter__.return_value=response;response.read.return_value=b'x'*11
        with patch.object(probe,'MAX_BODY_BYTES',10),patch.object(probe.OPENER,'open',return_value=response) as opened,patch.object(probe.signal,'setitimer') as timer:
            with self.assertRaisesRegex(probe.DiagnosticFailure,'response_too_large'):probe.fetch_body(BASE,'/privacy',time.monotonic()+20)
        opened.assert_called_once();response.read.assert_called_once_with(11);response.__exit__.assert_called_once()
        self.assertEqual(timer.call_args.args,(probe.signal.ITIMER_REAL,0))
        headers=dict(opened.call_args.args[0].header_items())
        self.assertNotIn('X-real-ip',headers);self.assertNotIn('Cookie',headers)
    def test_redirect_and_elapsed_budget_do_not_make_requests(self):
        with self.assertRaisesRegex(probe.DiagnosticFailure,'unexpected_redirect'):probe.NoRedirect().redirect_request(None,None,None,None,None,None)
        with patch.object(probe.OPENER,'open') as opened:
            with self.assertRaisesRegex(probe.DiagnosticFailure,'total_deadline'):probe.fetch_body(BASE,'/privacy',time.monotonic()-1)
        opened.assert_not_called()

class AcceptanceWorkflowTests(unittest.TestCase):
    def test_exact_baseline_acceptance_is_required_before_observations(self):
        workflow=(ROOT/'.github/workflows/public-page-latency.yml').read_text()
        check=textwrap.dedent(workflow.split("          python3 - <<'CHECK'\n",1)[1].split('\n          CHECK',1)[0])
        marker={'mode':'accepted-release','release':'8731103c0102886064c6a0a19a14182502e6e3be','acceptedRunId':43079097899,'acceptedControl':'edcec4b74d8a8ebd45a24a01a723a39f64c19f2b'}
        valid={'id':marker['acceptedRunId'],'head_sha':marker['acceptedControl'],'status':'completed','conclusion':'success',
               'head_repository':{'full_name':'jeep-jim/AvtoCena'},'path':'.github/workflows/owner-accept-prepared-873.yml'}
        original=os.getcwd()
        with tempfile.TemporaryDirectory() as directory,patch.dict(os.environ,{'RUNNER_TEMP':directory,'GITHUB_OUTPUT':directory+'/output'}),contextlib.redirect_stdout(io.StringIO()):
            try:
                os.chdir(directory);pathlib.Path('.github/market-runs').mkdir(parents=True)
                pathlib.Path('.github/market-runs/public-page-latency.json').write_text(json.dumps(marker))
                for changes,accepted in [({},True),({'status':'in_progress'},False),({'conclusion':'failure'},False),({'id':123},False),({'head_sha':'c'*40},False),({'path':'.github/workflows/ci.yml'},False),({'head_repository':{'full_name':'someone/else'}},False)]:
                    pathlib.Path('public-pages-accepted-run.json').write_text(json.dumps({**valid,**changes}))
                    if accepted:exec(compile(check,'acceptance-check','exec'),{})
                    else:
                        with self.assertRaises(AssertionError):exec(compile(check,'acceptance-check','exec'),{})
            finally:os.chdir(original)
        self.assertIn('group: regcloud-production-release',workflow)
        self.assertIn('/run/lock/avtocena-runtime-change.lock',workflow)
        self.assertNotIn('regcloud-performance-gate.py',workflow)

    def test_optional_remote_pins_survive_ssh_omitting_empty_trailing_arguments(self):
        workflow=(ROOT/'.github/workflows/public-page-latency.yml').read_text()
        preamble=textwrap.dedent(workflow.split("<<'REMOTE'\n",1)[1].split('          exec 9>',1)[0])
        # SSH serializes argv through the remote shell: absent trailing empty
        # strings must preserve the accepted-release mode without weakening pins.
        for extras in [[],['sha256:fixed-image','fixed-calculation']]:
            command=preamble+'printf "%s|%s" "$expected_image" "$expected_calculation"\n'
            result=subprocess.run(['bash','-s','--',RELEASE,'/tmp/diagnostic',*extras],input=command,text=True,capture_output=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(result.stdout,'|'.join(extras) if extras else '|')

    def test_original_a182_mode_requires_frozen_baselines_and_successful_fixed_confirmation(self):
        workflow=(ROOT/'.github/workflows/public-page-latency.yml').read_text()
        check=textwrap.dedent(workflow.split("          python3 - <<'CHECK'\n",1)[1].split('\n          CHECK',1)[0])
        marker={'mode':'original-a182','release':'a182cd21b21ecf612b63613d263e5bdd817ea4c0',
                'confirmationRunId':43081159796,'confirmationControl':'902043eafa1111e83aa32155b4845187b6a39495'}
        valid={'id':marker['confirmationRunId'],'head_sha':marker['confirmationControl'],'status':'completed','conclusion':'success',
               'head_repository':{'full_name':'jeep-jim/AvtoCena'},'path':'.github/workflows/inspect-rejected-873-runtime.yml'}
        names=['2026-11-11-accepted-speed-baseline.json','2026-11-11-accepted-browser-speed-baseline.json']
        original=os.getcwd()
        with tempfile.TemporaryDirectory() as directory,patch.dict(os.environ,{'RUNNER_TEMP':directory,'GITHUB_OUTPUT':directory+'/output'}),contextlib.redirect_stdout(io.StringIO()):
            try:
                os.chdir(directory);pathlib.Path('.github/market-runs').mkdir(parents=True);pathlib.Path('docs/operations').mkdir(parents=True)
                pathlib.Path('.github/market-runs/public-page-latency.json').write_text(json.dumps(marker))
                for name in names:pathlib.Path('docs/operations',name).write_bytes((ROOT/'docs/operations'/name).read_bytes())
                for changes,accepted in [({},True),({'status':'in_progress'},False),({'conclusion':'failure'},False),({'id':123},False),({'head_sha':'c'*40},False),({'path':'.github/workflows/ci.yml'},False)]:
                    pathlib.Path('public-pages-accepted-run.json').write_text(json.dumps({**valid,**changes}))
                    if accepted:exec(compile(check,'original-baseline-check','exec'),{})
                    else:
                        with self.assertRaises(AssertionError):exec(compile(check,'original-baseline-check','exec'),{})
                output=pathlib.Path('output').read_text()
                self.assertIn('image=sha256:e36c969dc5a21a1654d738a2fe76c4657cd75ad48ffeff4c87845f67035c6f6f',output)
                self.assertIn('calculation=c489dff0d41ef0933b4f2bef140a318d4ce68493587afc8113a9993e5a18b0b6',output)
                pathlib.Path('public-pages-accepted-run.json').write_text(json.dumps(valid))
                for name in names:
                    target=pathlib.Path('docs/operations',name);original_bytes=target.read_bytes();target.write_bytes(original_bytes+b' ')
                    with self.assertRaisesRegex(AssertionError,'original accepted baseline changed'):exec(compile(check,'original-baseline-check','exec'),{})
                    target.write_bytes(original_bytes)
            finally:os.chdir(original)

if __name__=='__main__':unittest.main()
