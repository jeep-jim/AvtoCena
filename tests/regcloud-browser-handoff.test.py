"""Exercise the real runner wrapper with fake transports; never contact a server."""
import json,os,pathlib,subprocess,sys,tempfile,unittest
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
import json,os,pathlib,sys
mode=os.environ['FIXTURE_BROWSER_MODE']
if mode=='missing':sys.exit(1)
json.dump({'release':os.environ['FIXTURE_RELEASE'],'passed':True,'browserPassed':True,'speedGuard':{'passed':mode=='pass'}},open('owner-filter-browser-report.json','w'))
'''
class HandoffTests(unittest.TestCase):
 def test_only_successful_correct_and_fast_browser_verdict_can_complete(self):
  for mode in ['pass','slow','missing']:
   with self.subTest(mode=mode),tempfile.TemporaryDirectory() as d:
    root=pathlib.Path(d);bins=root/'bin';bins.mkdir();runtime=root/'runtime';runtime.mkdir()
    for name,body in [('ssh',TRANSPORT),('scp',TRANSPORT),('node',NODE),('google-chrome','')]:
     file=bins/name;file.write_text('#!'+sys.executable+'\n'+body);file.chmod(0o700)
    key=root/'key';key.write_text('fixture only')
    env={**os.environ,'PATH':str(bins)+os.pathsep+os.environ['PATH'],'GITHUB_WORKSPACE':str(ROOT),'FIXTURE_ROOT':str(ROOT),'FIXTURE_RELEASE':RELEASE,'FIXTURE_RUNTIME':str(runtime),'FIXTURE_BROWSER_MODE':mode}
    result=subprocess.run(['bash',str(ROOT/'scripts/regcloud-deploy-with-browser.sh'),str(key),RELEASE,'c'*64,'china'],cwd=root,env=env,capture_output=True,text=True,timeout=55)
    self.assertEqual(result.returncode==0,mode=='pass',result.stdout+result.stderr)
    self.assertEqual((runtime/'outcome').read_text(),'accepted' if mode=='pass' else 'rejected')
if __name__=='__main__':unittest.main()
