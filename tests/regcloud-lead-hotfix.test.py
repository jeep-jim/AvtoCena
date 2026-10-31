import pathlib,runpy,tempfile,unittest.mock as mock,json,urllib.error,subprocess,shutil
source=pathlib.Path('scripts/regcloud-lead-request-hotfix.py').read_text()
# Exercise both successful install and automatic restoration without production access.
for fail in (False,True):
 with tempfile.TemporaryDirectory() as tmp:
  file=pathlib.Path(tmp)/'run.py'; file.write_text(source.replace("pathlib.Path('/opt/avtocena/incidents/lead-request-20261031')",f'pathlib.Path({tmp!r})'))
  calls=[];posts=[]
  def command(args,**kw):
   calls.append(args)
   if args[:2]==('docker','inspect'):return json.dumps({"3000/tcp":[{"HostIp":"127.0.0.1","HostPort":"3001"}]})
   if args[:2]==('docker','cp') and args[2].startswith('avtocena-production:/app'):
    pathlib.Path(args[3]).write_text('async function q(a,c){return new Request(a,{headers:c})}')
   return ''
  class Reply:
   status=200
   def __enter__(self):return self
   def __exit__(self,*a):pass
   def read(self):return json.dumps({'releaseSha':'5e45cd9478a7d38a6c57adc7d81061e475055cf9'}).encode()
  def http(req,**kw):
   if req.full_url.endswith('/api/health'):return Reply()
   posts.append(req)
   import io
   code=500 if fail else 403 if req.headers['Origin']=='https://foreign.example' else 400
   error='origin_forbidden' if code==403 else 'personal_data_consent_required'
   raise urllib.error.HTTPError(req.full_url,code,'',{},io.BytesIO(json.dumps({'error':error}).encode()))
  with mock.patch('subprocess.check_output',command),mock.patch('urllib.request.urlopen',http):
   try:runpy.run_path(str(file))
   except AssertionError:assert fail
   else:assert not fail
  fixed=pathlib.Path(tmp)/'route.fixed.js'
  subprocess.run(['node','--check',str(fixed)],check=True)
  assert 'await a.text()' in fixed.read_text()
  restores=[c for c in calls if c[:2]==('docker','cp') and c[2]==str(pathlib.Path(tmp)/'route.original.js')]
  assert len(restores)==int(fail)
print('hotfix install and rollback fixtures PASS')
