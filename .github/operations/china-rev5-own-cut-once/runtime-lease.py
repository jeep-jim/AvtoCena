"""Protected host read/check only. Hold inherited existing runtime lock; no file creation."""
import fcntl,json,os,stat,subprocess,sys,time,urllib.request
RELEASE='22867cbcfaee27b2e8917b6bf880e44827f67b60'
CALC='4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90'
IMAGE='sha256:8a7326fc17de9a28ae66a4915e68038ac089ba4cdf2954bd7fcbd7cbda46ccf8'
CONTAINER='52e44ba2810796f9a12ac83984d9571f71ac1290d852206d2a259ad44da02a8d'
LIMIT=480
def require(x):
 if not x: raise ValueError()
def test():
 raw=subprocess.check_output(['/usr/bin/docker','inspect','--type','container',CONTAINER],timeout=5)
 c=json.loads(raw)
 require(len(c)==1); c=c[0]
 require(c['Id']==CONTAINER and c['Image']==IMAGE and c['State']['Running'] is True and c['State']['Restarting'] is False)
 env=dict(x.split('=',1) for x in c['Config']['Env'])
 require(env['AVTOCENA_RELEASE_SHA']==RELEASE and env['AVTOCENA_CALCULATION_VERSION']==CALC and env['AVTOCENA_CHINA_REGCLOUD_RUNTIME']=='1')
 with urllib.request.urlopen('http://127.0.0.1:3002/api/health',timeout=7) as r:
  require(r.status==200); proof=json.loads(r.read(65537))
 require(proof.get('service')=='avtocena-web' and proof.get('ok') is True and proof.get('releaseSha')==RELEASE and proof.get('calculationVersion')==CALC)
 return c['State']['StartedAt']
def main():
 require(os.geteuid()==0)
 fd=os.open('/run/lock/avtocena-runtime-change.lock',os.O_RDONLY|os.O_NOFOLLOW)
 st=os.fstat(fd)
 require(stat.S_ISREG(st.st_mode) and st.st_uid==0 and not st.st_mode&0o022)
 fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
 expiry=time.monotonic()+LIMIT
 began=test()
 print('held',flush=True)
 for line in sys.stdin:
  require(time.monotonic()<expiry)
  if line=='finish\n':break
  require(line=='recheck\n' and test()==began)
  print('held',flush=True)
try:
 main()
except Exception:
 print('runtime_lease_refused',file=sys.stderr,flush=True)
 sys.exit(2)
