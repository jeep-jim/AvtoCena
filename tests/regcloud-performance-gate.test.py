import importlib.util,json,pathlib,unittest,io,contextlib,sys
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('gate','scripts/regcloud-performance-gate.py');gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
class GateTests(unittest.TestCase):
 def test_live_candidate_uses_observed_ssh_peer_without_invented_ip(self):
  with patch.dict(gate.os.environ,{'SSH_CONNECTION':'8.8.4.4 54321 151.248.113.177 22'}):
   self.assertEqual(gate.probe_headers('http://127.0.0.1:3001','/cars?market=korea','catalog')['X-Real-IP'],'8.8.4.4')
   self.assertNotIn('X-Real-IP',gate.probe_headers('https://avtocena.com','/cars?market=korea','catalog'))
   self.assertNotIn('X-Real-IP',gate.probe_headers('http://127.0.0.1:3001','/api/health','health'))
  for connection in ['', '127.0.0.1 123 127.0.0.1 22','invalid 123 151.248.113.177 22']:
   with patch.dict(gate.os.environ,{'SSH_CONNECTION':connection}):
    with self.assertRaises(AssertionError):gate.probe_headers('http://127.0.0.1:3001','/cars?market=korea','catalog')
 def test_lead_validation_posts_empty_body_and_rejects_crashes(self):
  gate.validate('/api/leads','lead_validation',400,b'{"error":"personal_data_consent_required"}','x')
  for status,body in [(500,b''),(200,b'{"ok":true}'),(403,b'{"error":"origin_forbidden"}'),(400,b'{"error":"other"}')]:
   with self.assertRaises(AssertionError):gate.validate('/api/leads','lead_validation',status,body,'x')
  response=gate.urllib.error.HTTPError('http://local/api/leads',400,'',{},io.BytesIO(b'{"error":"personal_data_consent_required"}'))
  with patch.object(gate.urllib.request,'urlopen',side_effect=response) as open_request:
   gate.sample('http://local','/api/leads','lead_validation','x')
  req=open_request.call_args.args[0]
  self.assertEqual(req.get_method(),'POST');self.assertEqual(req.data,b'{}')
 def test_rejects_partial_stream_and_false_success(self):
  for status,body in [(503,b'</html>'),(200,b'loading'),(200,b'$RX(error)</html>')]:
   with self.assertRaises(AssertionError):gate.validate('/','html',status,body,'x')
  for body in [{'items':[],'total':100},{'items':[{}],'total':0}]:
   with self.assertRaises(AssertionError):gate.validate('/search','search',200,json.dumps(body).encode(),'x')
  with self.assertRaises(AssertionError):gate.validate('/health','health',200,b'{"ok":true,"releaseSha":"old"}','new')
 def test_nonempty_search_does_not_hide_stale_partial_or_failed_data(self):
  valid={'ok':True,'items':[{'id':'car'}],'total':24}
  for flags in [{'stale':True},{'partial':True},{'interrupted':True},{'countIncomplete':True},{'error':'storage_timeout'},{'ok':False}]:
   with self.subTest(flags=flags),self.assertRaisesRegex(AssertionError,'performance_incomplete_search'):
    gate.validate('/api/catalog/search?market=china','search',200,json.dumps({**valid,**flags}).encode(),'x')
  # A complete page may still have subsequent pages. It must not be confused
  # with an interrupted/incomplete scan or an explicitly stale fallback.
  gate.validate('/api/catalog/search?market=china','search',200,json.dumps({**valid,'hasMore':True,'nextCursor':'page2','stale':False,'partial':False,'interrupted':False,'countIncomplete':False}).encode(),'x')
 def test_search_success_requires_real_rows_and_a_finite_positive_count(self):
  for value in [[],{'items':{'id':'not-an-array'},'total':24},{'items':[{}],'total':True},{'items':[{}],'total':'24'},{'items':[{}],'total':float('inf')},{'items':[{}],'total':float('nan')}]:
   with self.subTest(value=value),self.assertRaisesRegex(AssertionError,'performance_empty_search'):
    gate.validate('/api/catalog/search?market=china','search',200,json.dumps(value).encode(),'x')
 def test_catalog_error_page_cannot_pass_as_fast_html(self):
  for body in [b'<html>Catalog unavailable</html>',b'<html><article>News</article></html>',b'<html><article class="ac-catalog-card"></article></html>',b'<html><script>const fake="<article class=\'ac-catalog-card\'><a href=\'/cars/offer/fake\'>fake</a></article>";</script></html>']:
   with self.assertRaises(AssertionError):gate.validate('/cars','catalog',200,body,'x')
  gate.validate('/cars','catalog',200,b'<html><article class="ac-catalog-card"><a href="/cars/offer/real">Car</a></article></html>','x')
  for path,_,kind in gate.ROUTES:
   if path.startswith('/cars') and not path.startswith('/cars/autocatalog'):self.assertEqual(kind,'catalog')
 def test_encyclopedia_requires_brands_then_bounded_models(self):
  brands=b'<html><button class="ac-brand-card"><strong>Changan</strong><small>12 models</small></button></html>'
  models=b'<html><article class="ac-model-list-item"></article></html>'
  gate.validate('/cars/autocatalog','encyclopedia',200,brands,'x')
  gate.validate('/cars/autocatalog?make=Changan','encyclopedia',200,models,'x')
  for body in [b'<html>Preparing</html>',b'<html><button class="ac-brand-card"></button></html>',b'<html><button class="ac-brand-card" disabled>Changan</button></html>',b'<html><script>const fake="<button class=ac-brand-card>Changan</button>"</script></html>',models]:
   with self.assertRaises(AssertionError):gate.validate('/cars/autocatalog','encyclopedia',200,body,'x')
  for body in [brands,b'<html>Empty</html>',b'<html>'+b'<article class="ac-model-list-item"></article>'*41+b'</html>']:
   with self.assertRaises(AssertionError):gate.validate('/cars/autocatalog?make=Changan','encyclopedia',200,body,'x')
 def test_measurement_targets_and_functional_activation_checks_are_preserved(self):
  self.assertEqual(gate.PHASE_DELAYS,[('warm',0),('after_ttl',35),('after_directory_ttl',305)])
  limits={p:budget for p,budget,k in gate.ROUTES}
  self.assertEqual(limits, {
   '/api/health': .25, '/api/leads': 1, '/': 2, '/login': 1, '/autocalc': 1,
   '/cars': 2, '/cars?market=china&make=Volkswagen&page=2': 2,
   '/cars?market=china&city=%D0%9D%D0%BE%D0%B2%D0%BE%D0%BA%D1%83%D0%B7%D0%BD%D0%B5%D1%86%D0%BA': 2,
   '/cars?market=europe&make=BMW&page=2': 2, '/cars?sort=totalRub': 2,
   '/api/catalog/search?market=europe&make=BMW&page=2': 1, '/cars/autocatalog': 2,
   '/api/catalog/search?market=china&marketPage=1&page=9': 1, '/cars/autocatalog?make=Changan': 2,
  }, 'Owner made speed targets advisory; route coverage and honest measurements remain')
  self.assertEqual(len(gate.ROUTES), len(limits), 'Duplicate routes must not hide missing coverage')
  script=pathlib.Path('scripts/regcloud-deploy-production.sh').read_text()
  calls=[i for i in range(len(script)) if script.startswith('python3 "$runtime/regcloud-performance-gate.py"',i)]
  self.assertEqual(len(calls),2)
  self.assertLess(calls[0],script.index('systemctl reload nginx\nready='))
  promotion=script.index('docker update --cpus 6 --memory 10g "$candidate"')
  self.assertLess(calls[0],promotion,'pre-switch functional checks still run before production promotion')
  self.assertLess(promotion,script.index('python3 - "$config" "$old_port" "$port"'),'a resource promotion failure must leave the serving Nginx file unchanged')
  self.assertLess(promotion,script.index('systemctl reload nginx\nready='),'visitors must receive full production capacity before the previous process drains')
  self.assertGreater(calls[1],script.index('docker stop --time 30 "$old"'))
  self.assertLess(calls[1],script.index('committed=1'))
 def test_all_routes_are_checked_after_both_cache_deadlines(self):
  output=io.StringIO()
  with patch.object(sys,'argv',['gate','http://127.0.0.1','release']),patch.object(gate,'sample',return_value=.001) as sample,patch.object(gate.time,'sleep') as sleep,contextlib.redirect_stdout(output):
   gate.main()
  self.assertEqual(sample.call_count,len(gate.ROUTES)*4)
  self.assertEqual([call.args[0] for call in sleep.call_args_list],[35,305])
  rows=[json.loads(line) for line in output.getvalue().splitlines() if line.startswith('{')]
  for phase,_ in gate.PHASE_DELAYS:self.assertEqual([r['path'] for r in rows if r['performanceGate']==phase],[p for p,_,_ in gate.ROUTES])
 def test_slow_valid_response_records_warning_and_checks_remaining_routes(self):
  output=io.StringIO()
  with patch.object(sys,'argv',['gate','http://127.0.0.1','release']),patch.object(gate,'sample',return_value=3.5351) as sample,patch.object(gate.time,'sleep'),contextlib.redirect_stdout(output):
   gate.main()
  self.assertEqual(sample.call_count,len(gate.ROUTES)*4)
  rows=[json.loads(line) for line in output.getvalue().splitlines() if line.startswith('{')]
  measured=[r for r in rows if r.get('performanceGate')!='summary']
  self.assertEqual(len(measured),42)
  self.assertTrue(all(r['functionalPassed'] and not r['passed'] for r in measured))
  self.assertEqual(rows[-1]['slowSamples'],42)
  self.assertFalse(rows[-1]['performanceAccepted'])
  self.assertIn('::warning::',output.getvalue())
 def test_functional_failure_and_unavailable_response_still_abort(self):
  for failure in [AssertionError('performance_empty_catalog:/cars'),TimeoutError('unavailable')]:
   with patch.object(sys,'argv',['gate','http://127.0.0.1','release']),patch.object(gate,'sample',side_effect=failure),patch.object(gate.time,'sleep'):
    with self.assertRaises(type(failure)):gate.main()

class MarketScopeTests(unittest.TestCase):
 def test_korea_does_not_probe_china_and_still_rejects_empty_catalog(self):
  routes=gate.release_routes('korea')
  self.assertIn(('/cars?market=korea',2.0,'catalog'),routes)
  self.assertIn(('/api/health',.25,'health'),routes)
  self.assertIn(('/cars/autocatalog',2.0,'encyclopedia'),routes)
  self.assertIn(('/cars/autocatalog?make=Changan',2.0,'encyclopedia'),routes)
  self.assertFalse(any('china' in p or p in ['/','/cars','/cars?sort=totalRub'] for p,_,_ in routes))
  with self.assertRaises(AssertionError):gate.validate('/cars?market=korea','catalog',200,b'<html>Unavailable</html>','x')
 def test_invalid_scope_fails_closed(self):
  for scope in ['all','korea,','korea,korea','bad','Korea']:
   with self.assertRaises(ValueError):gate.release_routes(scope)
  self.assertEqual(gate.release_routes(''),gate.ROUTES)
 def test_selected_routes_run_before_and_after_expiry_without_other_markets(self):
  with patch.dict(gate.os.environ,{'AVTOCENA_RELEASE_MARKETS':'korea'}),patch.object(sys,'argv',['gate','http://127.0.0.1','release']),patch.object(gate,'sample',return_value=.001) as sample,patch.object(gate.time,'sleep'),contextlib.redirect_stdout(io.StringIO()):
   gate.main()
  self.assertEqual(sample.call_count,len(gate.release_routes('korea'))*4)
  self.assertTrue(all('china' not in call.args[1] for call in sample.call_args_list))

class AcceptedBaselineTests(unittest.TestCase):
 def test_expired_slow_response_cannot_be_cleared_by_warm_retries(self):
  rows={'/path':[{'phase':'warm_'+str(i),'seconds':.5} for i in range(1,4)]+[{'phase':'after_ttl','seconds':1.0},{'phase':'after_directory_ttl','seconds':1.2}]}
  for phase in ['after_ttl','after_directory_ttl']:
   with patch.object(gate,'sample',return_value=.001) as sample,contextlib.redirect_stdout(io.StringIO()) as output:
    with self.assertRaisesRegex(AssertionError,'accepted_speed_regression:/path'):
     gate.check_baseline('local','/path','html','release',phase,3.7252,rows,True)
    sample.assert_not_called()
    result=json.loads(output.getvalue());self.assertFalse(result['passed'])
    self.assertEqual(result['seconds'],3.7252)
    self.assertNotIn('recheckMedianSeconds',result)
 def test_unknown_phase_cannot_use_a_looser_expiry_reference(self):
  rows={'/path':[{'phase':'warm_1','seconds':.5}]}
  with self.assertRaisesRegex(AssertionError,'accepted_speed_phase_invalid'):
   gate.check_baseline('local','/path','html','release','unknown',.1,rows,True)

 def test_frozen_capture_has_all_correct_routes_and_expiry_phases(self):
  baseline=gate.accepted_baseline('docs/operations/2026-11-11-accepted-speed-baseline.json')
  self.assertEqual(len(baseline),17)
  self.assertIn('/cars/china/BMW/3?powerTo=160&sort=totalRub',baseline)
  self.assertIn('/api/catalog/search?market=china&budgetTo=1500000&pageSize=6',baseline)
 def test_repeated_slowdown_blocks_but_an_isolated_jitter_is_recorded(self):
  rows={'/path':[{'phase':'warm_'+str(i),'seconds':.5} for i in range(1,4)]+[{'phase':'after_ttl','seconds':1.0},{'phase':'after_directory_ttl','seconds':1.2}]}
  with patch.object(gate,'sample',side_effect=[.7,.8,.9]) as sample,contextlib.redirect_stdout(io.StringIO()):
   with self.assertRaisesRegex(AssertionError,'accepted_speed_regression'):gate.check_baseline('local','/path','html','release','warm',.8,rows,True)
   self.assertEqual(sample.call_count,3)
  with patch.object(gate,'sample',side_effect=[.51,.48,.53]),contextlib.redirect_stdout(io.StringIO()):
   result=gate.check_baseline('local','/path','html','release','warm',.8,rows,True)
  self.assertTrue(result['passed']);self.assertEqual(result['recheckMedianSeconds'],.51)
  with patch.object(gate,'sample',side_effect=AssertionError('must not repeat')) as sample,contextlib.redirect_stdout(io.StringIO()):
   self.assertTrue(gate.check_baseline('local','/path','html','release','after_ttl',1.1,rows,True)['passed'])
 def test_limited_candidate_resources_are_observed_and_full_serving_resources_are_enforced(self):
  script=pathlib.Path('scripts/regcloud-deploy-production.sh').read_text()
  first=script.index('python3 "$runtime/regcloud-performance-gate.py"')
  self.assertLess(script.index('export AVTOCENA_SPEED_BASELINE_MODE=observe'),first)
  enforced=script.index('export AVTOCENA_SPEED_BASELINE_MODE=enforce')
  self.assertLess(script.index('docker stop --time 30 "$old"'),enforced)
  self.assertLess(enforced,script.rindex('python3 "$runtime/regcloud-performance-gate.py"'))
  self.assertLess(script.rindex('python3 "$runtime/regcloud-performance-gate.py"'),script.index('committed=1'))
  workflow=pathlib.Path('.github/workflows/regcloud-deploy.yml').read_text()
  self.assertIn('docs/operations/2026-11-11-accepted-speed-baseline.json',workflow)
 def test_missing_baseline_cannot_silently_disable_enforced_acceptance(self):
  with patch.dict(gate.os.environ,{'AVTOCENA_SPEED_BASELINE_MODE':'enforce','AVTOCENA_SPEED_BASELINE':''}),patch.object(sys,'argv',['gate','local','release']):
   with self.assertRaisesRegex(AssertionError,'accepted_speed_baseline_missing'):gate.main()

if __name__=='__main__':unittest.main()
