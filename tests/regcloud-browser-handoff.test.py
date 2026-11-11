"""Exercise the real runner wrapper with fake transports; never contact a server."""
import json,os,pathlib,shutil,subprocess,sys,tempfile,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
RELEASE='a'*40
TRANSPORT=r'''
import importlib.util,json,os,pathlib,re,shutil,subprocess,sys
runtime=pathlib.Path(os.environ['FIXTURE_RUNTIME'])
command=sys.argv[-1]
if pathlib.Path(sys.argv[0]).name=='scp':
 source,target=sys.argv[-2:]
 destination=target.split(':',1)[1].replace('/opt/avtocena/releases/'+os.environ['FIXTURE_RELEASE'],str(runtime))
 shutil.copyfile(source,destination)
 sys.exit(0)
if command.startswith('AVTOCENA_BROWSER_NONCE='):
 nonce=re.search(r"AVTOCENA_BROWSER_NONCE='([a-f0-9]+)'",command).group(1)
 spec=importlib.util.spec_from_file_location('verdict',os.environ['FIXTURE_ROOT']+'/scripts/regcloud-browser-verdict.py')
 v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
 try:
  v.wait_for_verdict(runtime,os.environ['FIXTURE_RELEASE'],nonce,timeout=35)
  (runtime/'outcome').write_text('accepted')
 except Exception:
  (runtime/'outcome').write_text('rejected')
  sys.exit(1)
else:
 command=command.replace('/opt/avtocena/releases/'+os.environ['FIXTURE_RELEASE'],str(runtime))
 assert command.startswith(('test -s ','mv ')), command
 sys.exit(subprocess.run(['bash','-c',command]).returncode)
'''
NODE=r'''
import json,os,pathlib,subprocess,sys
if sys.argv[1]=='scripts/verify-frozen-speed-baselines.mjs':
 sys.exit(subprocess.run([os.environ['FIXTURE_REAL_NODE'],sys.argv[1]],cwd=os.environ['FIXTURE_ROOT']).returncode)
mode=os.environ['FIXTURE_BROWSER_MODE']
if mode=='missing':sys.exit(1)
json.dump({'release':os.environ['FIXTURE_RELEASE'],'passed':True,'browserPassed':True,'speedGuard':{'passed':mode=='pass'}},open('owner-filter-browser-report.json','w'))
'''
class HandoffTests(unittest.TestCase):
 def test_modified_server_or_browser_baseline_stops_before_any_transport(self):
  for filename in ['2026-11-11-accepted-speed-baseline.json','2026-11-11-accepted-browser-speed-baseline.json']:
   with self.subTest(filename=filename),tempfile.TemporaryDirectory() as d:
    root=pathlib.Path(d);bins=root/'bin';bins.mkdir();(root/'scripts').mkdir();(root/'docs/operations').mkdir(parents=True)
    shutil.copyfile(ROOT/'scripts/verify-frozen-speed-baselines.mjs',root/'scripts/verify-frozen-speed-baselines.mjs')
    for source in ['2026-11-11-accepted-speed-baseline.json','2026-11-11-accepted-browser-speed-baseline.json']:
     shutil.copyfile(ROOT/'docs/operations'/source,root/'docs/operations'/source)
    target=root/'docs/operations'/filename;value=json.loads(target.read_text())
    if 'samples' in value:value['samples'][0]['seconds']*=2
    else:value['checks'][0]['firstCardsSeconds']*=2
    target.write_text(json.dumps(value))
    called=root/'transport-called'
    for name in ['ssh','scp']:
     file=bins/name;file.write_text('#!'+sys.executable+'\nimport pathlib,sys\npathlib.Path('+repr(str(called))+').touch()\nsys.exit(1)\n');file.chmod(0o700)
    key=root/'key';key.write_text('fixture only')
    result=subprocess.run(['bash',str(ROOT/'scripts/regcloud-deploy-with-browser.sh'),str(key),RELEASE,'c'*64,'china'],cwd=root,env={**os.environ,'PATH':str(bins)+os.pathsep+os.environ['PATH']},capture_output=True,text=True,timeout=10)
    self.assertNotEqual(result.returncode,0)
    self.assertIn('frozen_speed_baseline_changed',result.stderr)
    self.assertFalse(called.exists(),'modified acceptance evidence must stop before SSH/SCP')

 def test_only_successful_correct_and_fast_browser_verdict_can_complete(self):
  for mode in ['pass','slow','missing']:
   with self.subTest(mode=mode),tempfile.TemporaryDirectory() as d:
    root=pathlib.Path(d);bins=root/'bin';bins.mkdir();runtime=root/'runtime';runtime.mkdir()
    for name,body in [('ssh',TRANSPORT),('scp',TRANSPORT),('node',NODE),('google-chrome','')]:
     file=bins/name;file.write_text('#!'+sys.executable+'\n'+body);file.chmod(0o700)
    key=root/'key';key.write_text('fixture only')
    env={**os.environ,'PATH':str(bins)+os.pathsep+os.environ['PATH'],'GITHUB_WORKSPACE':str(ROOT),'FIXTURE_ROOT':str(ROOT),'FIXTURE_REAL_NODE':shutil.which('node'),'FIXTURE_RELEASE':RELEASE,'FIXTURE_RUNTIME':str(runtime),'FIXTURE_BROWSER_MODE':mode}
    result=subprocess.run(['bash',str(ROOT/'scripts/regcloud-deploy-with-browser.sh'),str(key),RELEASE,'c'*64,'china'],cwd=root,env=env,capture_output=True,text=True,timeout=55)
    self.assertEqual(result.returncode==0,mode=='pass',result.stdout+result.stderr)
    self.assertEqual((runtime/'outcome').read_text(),'accepted' if mode=='pass' else 'rejected')
if __name__=='__main__':unittest.main()
