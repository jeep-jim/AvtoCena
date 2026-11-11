import importlib.util,json,pathlib,tempfile,unittest
spec=importlib.util.spec_from_file_location('verdict','scripts/regcloud-browser-verdict.py');v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
RELEASE='a'*40;NONCE='b'*32
def good():return {'schemaVersion':1,'release':RELEASE,'nonce':NONCE,'passed':True,'functionalPassed':True,'speedPassed':True,'reportSha256':'c'*64}
class VerdictTests(unittest.TestCase):
 def test_success_is_bound_to_release_nonce_functionality_and_speed(self):
  self.assertEqual(v.validate_verdict(good(),RELEASE,NONCE),good())
  for key,value in [('release','d'*40),('nonce','e'*32),('passed',False),('functionalPassed',False),('speedPassed',False),('reportSha256',''),('schemaVersion',2)]:
   item=good();item[key]=value
   with self.assertRaises(AssertionError):v.validate_verdict(item,RELEASE,NONCE)
 def test_missing_browser_receipt_is_blocking(self):
  with tempfile.TemporaryDirectory() as d:
   ticks=iter([0,301])
   with self.assertRaisesRegex(AssertionError,'browser_acceptance_missing_or_timed_out'):
    v.wait_for_verdict(d,RELEASE,NONCE,clock=lambda:next(ticks),sleep=lambda _:None)
   self.assertEqual(json.loads((pathlib.Path(d)/('browser-ready-'+NONCE+'.json')).read_text())['phase'],'post-switch-server-passed')
 def test_failed_receipt_cannot_commit_release(self):
  with tempfile.TemporaryDirectory() as d:
   path=pathlib.Path(d)/('browser-verdict-'+NONCE+'.json')
   item=good();item['speedPassed']=False;path.write_text(json.dumps(item))
   with self.assertRaisesRegex(AssertionError,'browser_acceptance_failed'):v.wait_for_verdict(d,RELEASE,NONCE)
 def test_atomic_ready_then_valid_verdict(self):
  with tempfile.TemporaryDirectory() as d:
   path=pathlib.Path(d)/('browser-verdict-'+NONCE+'.json');path.write_text(json.dumps(good()))
   self.assertEqual(v.wait_for_verdict(d,RELEASE,NONCE)['reportSha256'],'c'*64)
 def test_deploy_cannot_commit_without_browser_and_workflow_cannot_skip_handshake(self):
  script=pathlib.Path('scripts/regcloud-deploy-production.sh').read_text()
  self.assertLess(script.index('AVTOCENA_BROWSER_NONCE:?'),script.index('docker run -d'))
  self.assertLess(script.rindex('regcloud-performance-gate.py'),script.index('python3 "$runtime/regcloud-browser-verdict.py"'))
  self.assertLess(script.index('python3 "$runtime/regcloud-browser-verdict.py"'),script.index('committed=1'))
  workflow=pathlib.Path('.github/workflows/regcloud-deploy.yml').read_text()
  self.assertIn('scripts/regcloud-deploy-with-browser.sh',workflow)
  self.assertIn('scripts/regcloud-browser-verdict.py',workflow)
if __name__=='__main__':unittest.main()
