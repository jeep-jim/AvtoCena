import importlib.util,json,pathlib,unittest,io,contextlib,sys
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('gate','scripts/regcloud-performance-gate.py');gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
OWNER_BMW_ROUTE='/cars/china/BMW/3%20SERIES?powerTo=160&sort=totalRub&city=%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0'
class GateTests(unittest.TestCase):
 def test_live_candidate_uses_observed_ssh_peer_without_invented_ip(self):
  with patch.dict(gate.os.environ,{'SSH_CONNECTION':'8.8.4.4 54321 151.248.113.177 22'}):
   self.assertEqual(gate.probe_headers('http://127.0.0.1:3001','/cars?market=korea','catalog')['X-Real-IP'],'8.8.4.4')
   self.assertEqual(gate.probe_headers('http://127.0.0.1:3001','/cars/korea/Hyundai/TUCSON','catalog')['X-Real-IP'],'8.8.4.4')
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
 def test_preparation_http_failure_identifies_route_and_stops_without_retry_or_private_data(self):
  output=io.StringIO();private_body=io.BytesIO(b'private response body')
  response=io.BytesIO(b'{"ok":true,"releaseSha":"release"}');response.status=200
  failure=gate.urllib.error.HTTPError('http://private-host'+OWNER_BMW_ROUTE,500,'private reason',{'X-Private':'private header'},private_body)
  routes=[('/api/health',.25,'health'),(OWNER_BMW_ROUTE,2,'catalog'),('/cars?market=uae',2,'catalog')]
  with patch.object(sys,'argv',['gate','http://local','release']),patch.object(gate,'release_routes',return_value=routes),patch.object(gate.urllib.request,'urlopen',side_effect=[response,failure]) as request,patch.object(gate.time,'sleep') as sleep,contextlib.redirect_stdout(output):
   with self.assertRaises(gate.urllib.error.HTTPError) as raised:gate.main()
  self.assertIs(raised.exception,failure)
  self.assertEqual(request.call_count,2);sleep.assert_not_called()
  self.assertEqual([call.args[0].full_url for call in request.call_args_list],['http://local/api/health','http://local'+OWNER_BMW_ROUTE])
  self.assertTrue(all(call.kwargs['timeout']==gate.REQUEST_TIMEOUT_SECONDS for call in request.call_args_list))
  self.assertEqual(json.loads(output.getvalue()),{'performanceGate':'failure','stage':'preparation','path':OWNER_BMW_ROUTE,'kind':'catalog','status':500,'error':'HTTPError','functionalPassed':False})
  self.assertEqual(private_body.tell(),0)
  for value in ['private-host','private reason','private header','private response body']:self.assertNotIn(value,output.getvalue())
 def test_expired_cache_failure_logs_actual_stage_and_does_not_continue_or_accept(self):
  output=io.StringIO();failure=gate.urllib.error.HTTPError('http://local'+OWNER_BMW_ROUTE,503,'private reason',{},None)
  with patch.object(sys,'argv',['gate','http://local','release']),patch.object(gate,'release_routes',return_value=[(OWNER_BMW_ROUTE,2,'catalog')]),patch.object(gate,'sample',side_effect=[.01,.01,failure]) as sample,patch.object(gate.time,'sleep') as sleep,contextlib.redirect_stdout(output):
   with self.assertRaises(gate.urllib.error.HTTPError) as raised:gate.main()
  self.assertIs(raised.exception,failure);self.assertEqual(sample.call_count,3);sleep.assert_called_once_with(35)
  rows=[json.loads(line) for line in output.getvalue().splitlines()]
  self.assertEqual([row['performanceGate'] for row in rows],['warm','failure'])
  self.assertEqual(rows[-1],{'performanceGate':'failure','stage':'after_ttl','path':OWNER_BMW_ROUTE,'kind':'catalog','status':503,'error':'HTTPError','functionalPassed':False})
 def test_expected_consent_error_is_still_success_without_failure_log(self):
  output=io.StringIO()
  response=gate.urllib.error.HTTPError('http://local/api/leads',400,'',{},io.BytesIO(b'{"error":"personal_data_consent_required"}'))
  with patch.object(gate.urllib.request,'urlopen',side_effect=response) as request,contextlib.redirect_stdout(output):
   self.assertGreaterEqual(gate.sample_with_context('http://local','/api/leads','lead_validation','release','preparation'),0)
  request.assert_called_once();self.assertEqual(output.getvalue(),'')
 def test_rejects_partial_stream_and_false_success(self):
  for status,body in [(503,b'</html>'),(200,b'loading'),(200,b'$RX(error)</html>')]:
   with self.assertRaises(AssertionError):gate.validate('/','html',status,body,'x')
  for body in [{'items':[],'total':100},{'items':[{}],'total':0}]:
   with self.assertRaises(AssertionError):gate.validate('/search','search',200,json.dumps(body).encode(),'x')
  with self.assertRaises(AssertionError):gate.validate('/health','health',200,b'{"ok":true,"releaseSha":"old"}','new')
 def test_catalog_error_page_cannot_pass_as_fast_html(self):
  for body in [b'<html>Catalog unavailable</html>',b'<html><article>News</article></html>',b'<html><article class="ac-catalog-card"></article></html>',b'<html><script>const fake="<article class=\'ac-catalog-card\'><a href=\'/cars/offer/fake\'>fake</a></article>";</script></html>']:
   with self.assertRaises(AssertionError):gate.validate('/cars','catalog',200,body,'x')
  gate.validate('/cars','catalog',200,b'<html><article class="ac-catalog-card"><a href="/cars/offer/real">Car</a></article></html>','x')
  for path,_,kind in gate.ROUTES:
   if path.startswith('/cars') and not path.startswith('/cars/autocatalog'):self.assertEqual(kind,'catalog')
 def test_owner_bmw_model_url_requires_completed_linked_cards(self):
  self.assertIn((OWNER_BMW_ROUTE,2.0,'catalog'),gate.ROUTES)
  for status,body in [
   (503,b'<html>Catalog unavailable</html>'),
   (200,b'<html><h1>BMW 3%20SERIES</h1><p>No offers</p></html>'),
   (200,b'<html><article class="ac-catalog-card"><a href="/cars/china/BMW">Model</a></article></html>'),
   (200,b'<html><article class="ac-catalog-card"><a href="/cars/offer/real">Car</a></article>'),
   (200,b'<html><article class="ac-catalog-card"><a href="/cars/offer/real">Car</a></article><script>$RX(error)</script></html>'),
  ]:
   with self.subTest(status=status,body=body):
    with self.assertRaises(AssertionError):gate.validate(OWNER_BMW_ROUTE,'catalog',status,body,'x')
  gate.validate(OWNER_BMW_ROUTE,'catalog',200,b'<html><h1>BMW 3 SERIES</h1><article class="ac-catalog-card"><a href="/cars/offer/real">BMW 3 SERIES</a></article></html>','x')
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
   OWNER_BMW_ROUTE: 2,
   '/cars?market=europe&make=BMW&page=2': 2, '/cars?sort=totalRub': 2,
   '/api/catalog/search?market=europe&make=BMW&page=2': 1, '/cars/autocatalog': 2,
   '/api/catalog/search?market=china&marketPage=1&page=9': 1, '/cars/autocatalog?make=Changan': 2,
  }, 'Owner made speed targets advisory; route coverage and honest measurements remain')
  self.assertEqual(len(gate.ROUTES), len(limits), 'Duplicate routes must not hide missing coverage')
  script=pathlib.Path('scripts/regcloud-deploy-production.sh').read_text()
  calls=[i for i in range(len(script)) if script.startswith('python3 "$runtime/regcloud-performance-gate.py"',i)]
  self.assertEqual(len(calls),2)
  self.assertLess(calls[0],script.index('systemctl reload nginx\nready='))
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
  self.assertEqual(len(measured),45)
  self.assertTrue(all(r['functionalPassed'] and not r['passed'] for r in measured))
  self.assertEqual(rows[-1]['samples'],45)
  self.assertEqual(rows[-1]['slowSamples'],45)
  self.assertFalse(rows[-1]['performanceAccepted'])
  self.assertIn('::warning::',output.getvalue())
 def test_functional_failure_and_unavailable_response_still_abort(self):
  for failure in [AssertionError('performance_empty_catalog:/cars'),TimeoutError('unavailable')]:
   with patch.object(sys,'argv',['gate','http://127.0.0.1','release']),patch.object(gate,'sample',side_effect=failure),patch.object(gate.time,'sleep'):
    with self.assertRaises(type(failure)):gate.main()

class MarketScopeTests(unittest.TestCase):
 def test_china_scope_includes_owner_canonical_model_path_and_existing_query_routes(self):
  routes=gate.release_routes('china')
  self.assertIn((OWNER_BMW_ROUTE,2.0,'catalog'),routes)
  self.assertIn(('/cars?market=china&make=Volkswagen&page=2',2.0,'catalog'),routes)
  self.assertIn(('/api/catalog/search?market=china&marketPage=1&page=9',1.0,'search'),routes)
  self.assertIn(('/cars?market=china',2.0,'catalog'),routes)
  self.assertNotIn((OWNER_BMW_ROUTE,2.0,'catalog'),gate.release_routes('korea'))
  self.assertEqual(gate.release_routes('china,korea').count((OWNER_BMW_ROUTE,2.0,'catalog')),1)
  self.assertEqual(gate.route_market(OWNER_BMW_ROUTE+'&market=korea'),'china')
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

class HomeReleaseTests(unittest.TestCase):
 def valid_payload(self):
  return {'generationId':'gen_current','items':[{'id':'china-1','market':'china'}],
   'marketCounts':{market:1 if market=='china' else 0 for market in gate.MARKETS},'total':1,'countIncomplete':False}
 def test_explicit_home_release_adds_acceptance_without_dropping_any_scoped_route(self):
  for scope in ['', 'korea', 'china,korea,europe,uae,georgia']:
   before=gate.release_routes(scope);after=gate.release_routes(scope,True)
   self.assertEqual({p:b for p,b,k in before},{p:b for p,b,k in after if p in {r[0] for r in before}})
   self.assertIn(('/',2.0,'home_catalog'),after)
   self.assertIn(('/api/catalog/home',1.0,'home_snapshot'),after)
   self.assertEqual(len(after),len({p for p,b,k in after}))
  self.assertFalse(any(p in ['/','/api/catalog/home'] for p,b,k in gate.release_routes('korea')))
 def test_home_error_cannot_hide_behind_dealer_cards_or_a_completed_shell(self):
  cards=b'<article class="ac-catalog-card"><a href="/cars/offer/real">Car</a></article>'
  gate.validate('/','home_catalog',200,b'<html>'+cards+b'</html>','release')
  for body in [b'<html>Loading</html>',b'<html>'+cards+'Не удалось загрузить каталог. Обновите страницу через минуту.'.encode()+b'</html>',b'<html>'+cards+b'<script>$RX(error)</script></html>',b'<html>'+cards]:
   with self.assertRaises(AssertionError):gate.validate('/','home_catalog',200,body,'release')
 def test_home_payload_requires_real_generation_items_and_consistent_nonnegative_counts(self):
  payload=self.valid_payload()
  for incomplete in [False,True]:
   gate.validate('/api/catalog/home','home_snapshot',200,json.dumps({**payload,'countIncomplete':incomplete}).encode(),'release')
  # Japan/provider count may be unavailable while the local snapshot is complete.
  extra_green={**payload,'total':2,'countIncomplete':True}
  gate.validate('/api/catalog/home','home_snapshot',200,json.dumps(extra_green).encode(),'release')
  invalid=[{**payload,'generationId':''},{**payload,'items':[]},{**payload,'items':[{}]},
   {**payload,'total':None},{**payload,'total':0},{**payload,'total':True},{**payload,'countIncomplete':None},
   {**payload,'error':'catalog_home_failed'},{**payload,'failed':True},{**payload,'ok':False},
   {**payload,'marketCounts':{}},{**payload,'marketCounts':{**payload['marketCounts'],'china':-1}},
   {**payload,'marketCounts':{**payload['marketCounts'],'china':0}},
   {**payload,'marketCounts':{**payload['marketCounts'],'china':2}},
   {**payload,'marketCounts':{**payload['marketCounts'],'extra':None}}]
  for value in invalid:
   with self.subTest(value=value):
    with self.assertRaises(AssertionError):gate.validate('/api/catalog/home','home_snapshot',200,json.dumps(value).encode(),'release')
  with self.assertRaises(AssertionError):gate.validate('/api/catalog/home','home_snapshot',503,json.dumps(payload).encode(),'release')
 def test_flagged_home_runs_in_every_phase_and_false_flag_preserves_regular_scope(self):
  output=io.StringIO()
  with patch.dict(gate.os.environ,{'AVTOCENA_RELEASE_MARKETS':'china','AVTOCENA_RELEASE_REQUIRE_HOME_CATALOG':'1'}),patch.object(sys,'argv',['gate','http://127.0.0.1','release']),patch.object(gate,'sample',return_value=.001) as sample,patch.object(gate.time,'sleep'),contextlib.redirect_stdout(output):
   gate.main()
  routes=gate.release_routes('china',True)
  self.assertEqual(sample.call_count,len(routes)*4)
  for path in ['/','/api/catalog/home']:
   self.assertEqual(sum(call.args[1]==path for call in sample.call_args_list),4)
  report=[json.loads(line) for line in output.getvalue().splitlines() if line.startswith('{')][-1]
  self.assertTrue(report['requireHomeCatalog']);self.assertEqual(report['samples'],len(routes)*3)
  with patch.dict(gate.os.environ,{'AVTOCENA_RELEASE_REQUIRE_HOME_CATALOG':'true'}),patch.object(sys,'argv',['gate','http://127.0.0.1','release']),patch.object(gate,'sample') as sample:
   with self.assertRaisesRegex(ValueError,'flag_invalid'):gate.main()
   sample.assert_not_called()

if __name__=='__main__':unittest.main()
