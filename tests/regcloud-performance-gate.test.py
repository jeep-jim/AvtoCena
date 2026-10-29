import importlib.util,json,pathlib,unittest,io,contextlib,sys
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('gate','scripts/regcloud-performance-gate.py');gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
class GateTests(unittest.TestCase):
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
   if path.startswith('/cars') and path!='/cars/autocatalog':self.assertEqual(kind,'catalog')
 def test_encyclopedia_requires_real_bounded_rows(self):
  for body in [b'<html>Preparing</html>',b'<html><script>const fake="<article class=ac-model-list-item>"</script></html>',b'<html>'+b'<article class="ac-model-list-item"></article>'*41+b'</html>']:
   with self.assertRaises(AssertionError):gate.validate('/cars/autocatalog','encyclopedia',200,body,'x')
  gate.validate('/cars/autocatalog','encyclopedia',200,b'<html><article class="ac-model-list-item"></article></html>','x')
 def test_measurement_targets_and_functional_activation_checks_are_preserved(self):
  self.assertEqual(gate.PHASE_DELAYS,[('warm',0),('after_ttl',35),('after_directory_ttl',305)])
  limits={p:budget for p,budget,k in gate.ROUTES}
  self.assertEqual(limits, {
   '/api/health': .25, '/': 2, '/login': 1, '/autocalc': 1,
   '/cars': 2, '/cars?market=china&make=Volkswagen&page=2': 2,
   '/cars?market=china&city=%D0%9D%D0%BE%D0%B2%D0%BE%D0%BA%D1%83%D0%B7%D0%BD%D0%B5%D1%86%D0%BA': 2,
   '/cars?market=europe&make=BMW&page=2': 2, '/cars?sort=totalRub': 2,
   '/api/catalog/search?market=europe&make=BMW&page=2': 1, '/cars/autocatalog': 2,
   '/api/catalog/search?market=china&marketPage=1&page=9': 1,
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
  self.assertEqual(len(measured),36)
  self.assertTrue(all(r['functionalPassed'] and not r['passed'] for r in measured))
  self.assertEqual(rows[-1]['slowSamples'],36)
  self.assertFalse(rows[-1]['performanceAccepted'])
  self.assertIn('::warning::',output.getvalue())
 def test_functional_failure_and_unavailable_response_still_abort(self):
  for failure in [AssertionError('performance_empty_catalog:/cars'),TimeoutError('unavailable')]:
   with patch.object(sys,'argv',['gate','http://127.0.0.1','release']),patch.object(gate,'sample',side_effect=failure),patch.object(gate.time,'sleep'):
    with self.assertRaises(type(failure)):gate.main()
if __name__=='__main__':unittest.main()
