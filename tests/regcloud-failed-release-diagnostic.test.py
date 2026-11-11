import io,json,pathlib,runpy,subprocess,sys,time,unittest
from types import SimpleNamespace
from unittest.mock import patch
SCRIPT=pathlib.Path(__file__).resolve().parents[1]/'scripts/regcloud-failed-release-diagnostic.py'
class ProbeSafety(unittest.TestCase):
 def execute(self,fail=False):
  sha='a'*40;prod='b'*40;calls=[];urls=[];profile=[];clock=[0]
  state={'Status':'exited','Running':False,'OOMKilled':False,'ExitCode':0}
  info={'Config':{'Image':'avtocena-regcloud:'+sha},'State':state,'HostConfig':{'PortBindings':{'3000/tcp':[{'HostIp':'127.0.0.1','HostPort':'32123'}]},'Memory':10*1024**3,'NanoCpus':6*10**9}}
  def output(args,**kw):
   if '--format' in args:return '32122' if args[1]=='inspect' else '100MiB / CPU 0%'
   return json.dumps([info]).encode()
  def run(args,**kw):
   calls.append(args)
   if fail and args[:2]==['docker','start']:raise RuntimeError('injected failure')
   return SimpleNamespace(stdout='',stderr='')
  class Response(io.BytesIO):
   status=200;headers={}
  def urlopen(url,**kw):
   urls.append(url)
   if url.endswith('/api/health'):return Response(json.dumps({'ok':True,'releaseSha':prod if ':32122/' in url else sha}).encode())
   return Response(b'<html></html>')
  class Proc:
   def __init__(self,*a,**kw):self.stdin=io.StringIO();profile.append(len(urls))
   def communicate(self,**kw):return ('','')
   def kill(self):pass
  def read_text(p,*a,**kw):return 'unchanged config' if p.name.endswith('.conf') else 'sample' if p.name=='cpu-sample.mjs' else original(p,*a,**kw)
  original=pathlib.Path.read_text
  with patch.object(sys,'argv',[str(SCRIPT),sha,'--probe-long']),patch.object(subprocess,'check_output',side_effect=output),patch.object(subprocess,'run',side_effect=run),patch.object(subprocess,'Popen',Proc),patch('urllib.request.urlopen',side_effect=urlopen),patch.object(pathlib.Path,'read_text',read_text),patch.object(pathlib.Path,'read_bytes',return_value=b'unchanged config'),patch('builtins.open',return_value=io.StringIO()),patch('fcntl.flock'),patch('signal.signal'),patch.object(time,'sleep',side_effect=lambda n:clock.__setitem__(0,clock[0]+n)),patch.object(time,'monotonic',side_effect=lambda:clock[0]),patch('sys.stdout',new=io.StringIO()):
   if fail:
    with self.assertRaisesRegex(RuntimeError,'injected failure'):runpy.run_path(str(SCRIPT),run_name='__main__')
   else:runpy.run_path(str(SCRIPT),run_name='__main__')
  return calls,urls,profile
 def test_profile_targets_expired_total_price_and_restores_runtime(self):
  calls,urls,profile=self.execute()
  self.assertEqual(len(profile),1)
  self.assertTrue(urls[profile[0]].endswith('/cars?sort=totalRub'))
  self.assertEqual(urls[0],urls[-1])
  self.assertIn(['docker','update','--cpus','2','--memory','8g','avtocena-release-'+12*'a'],calls)
  self.assertEqual(calls[-1],['docker','logs','--tail','2000','avtocena-release-'+12*'a'])
  self.assertIn(['docker','update','--cpus','6.0','--memory',str(10*1024**3),'avtocena-release-'+12*'a'],calls)
 def test_failure_stops_candidate_and_restores_resources(self):
  calls,urls,_=self.execute(True)
  self.assertTrue(any(c[:2]==['docker','stop'] for c in calls))
  self.assertEqual(calls[-1][0:4],['docker','update','--cpus','6.0'])
  self.assertEqual(urls[0],urls[-1])
if __name__=='__main__':unittest.main()
