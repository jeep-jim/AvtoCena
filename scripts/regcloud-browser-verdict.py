#!/usr/bin/env python3
"""Bounded release handshake: a missing/failed browser result must roll back."""
import datetime,json,os,pathlib,re,sys,time

def validate_verdict(value,release,nonce):
 if not isinstance(value,dict) or value.get('schemaVersion')!=1:
  raise AssertionError('browser_verdict_invalid')
 if value.get('release')!=release or value.get('nonce')!=nonce:
  raise AssertionError('browser_verdict_identity_mismatch')
 if value.get('passed') is not True or value.get('functionalPassed') is not True or value.get('speedPassed') is not True:
  raise AssertionError('browser_acceptance_failed')
 if not re.fullmatch(r'[a-f0-9]{64}',value.get('reportSha256','')):
  raise AssertionError('browser_report_digest_missing')
 return value

def wait_for_verdict(directory,release,nonce,timeout=300,clock=time.monotonic,sleep=time.sleep):
 if not re.fullmatch(r'[a-f0-9]{40}',release) or not re.fullmatch(r'[a-f0-9]{32}',nonce):
  raise AssertionError('browser_handshake_identity_invalid')
 directory=pathlib.Path(directory)
 ready=directory/('browser-ready-'+nonce+'.json')
 temporary=ready.with_suffix('.tmp')
 with temporary.open('x') as stream:
  json.dump({'schemaVersion':1,'release':release,'nonce':nonce,'phase':'post-switch-server-passed','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat()},stream)
 os.replace(temporary,ready)
 print('BROWSER_ACCEPTANCE_REQUIRED',json.dumps({'release':release,'nonce':nonce,'timeoutSeconds':timeout}),flush=True)
 verdict=directory/('browser-verdict-'+nonce+'.json')
 until=clock()+timeout
 while True:
  if verdict.exists():
   if verdict.stat().st_size>4096:raise AssertionError('browser_verdict_too_large')
   value=validate_verdict(json.loads(verdict.read_text()),release,nonce)
   print('BROWSER_ACCEPTANCE_VERIFIED',json.dumps(value),flush=True)
   return value
  if clock()>=until:raise AssertionError('browser_acceptance_missing_or_timed_out')
  sleep(1)

if __name__=='__main__':
 if len(sys.argv)!=4:raise AssertionError('browser_handshake_arguments')
 wait_for_verdict(*sys.argv[1:])
