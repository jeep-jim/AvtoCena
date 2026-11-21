"""Local only: bind observed proof; refuses no-evidence or synthetic withdrawal."""
import argparse, hashlib, json, pathlib, re, time
q=argparse.ArgumentParser()
q.add_argument('--withdrawal-proof',type=pathlib.Path,required=True)
q.add_argument('--expected-withdrawal-sha256',required=True)
q.add_argument('--output',type=pathlib.Path,required=True)
a=q.parse_args()
d=pathlib.Path(__file__).parent
pins=json.loads((d/'verified-prepared-pins.json').read_text())
raw=a.withdrawal_proof.read_bytes();p=json.loads(raw)
h=hashlib.sha256(raw).hexdigest()
assert h==a.expected_withdrawal_sha256 and 0<len(raw)<=8192
assert p.get('kind')=='china-authenticated-explicit-terminal-withdrawal-v1'
assert p.get('terminalWitnessSha256')==pins['terminalWitnessSha256']
assert p.get('market')=='china' and p.get('source')=='che168'
assert p.get('explicitRemoved') is True and p.get('presentAtTerminal') is False and p.get('sourceAuthenticated') is True
assert re.fullmatch('[a-f0-9]{24}',p['stableOfferId'])
now=round(time.time()*1000)
expiry=min(now+14*60000,pins['sourceExpiresAt'])
assert expiry>now+120000
grant=dict(version=1,kind='china-private-preview-grant-v1',stage=pins['stage'],
 storage=dict(endpoint='https://s3.regru.cloud',bucket='avtocena-staging-8120751',prefix='migration-staging/full-20261011',region='us-east-1'),
 appSha='22867cbcfaee27b2e8917b6bf880e44827f67b60',
 legacyRuntimeSha256='4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90',
 imageSha256='8a7326fc17de9a28ae66a4915e68038ac089ba4cdf2954bd7fcbd7cbda46ccf8',expiresAt=expiry,
 archiveSha256=pins['archiveSha256'],manifestSha256=pins['manifestSha256'],pricingReceiptSha256=pins['pricingReceiptSha256'],
 admittedRows=pins['admittedRows'],make='BMW',model='X3',
 persistedGate=dict(runtimeReadySha256=pins['runtimeReadySha256'],withdrawalProofSha256=h,knownRemovedId=p['stableOfferId']),
 publicationAuthorized=False,cursorAdvanceAuthorized=False)
b=(json.dumps(grant,separators=(',',':'))+'\n').encode()
with a.output.open('xb') as f:f.write(b)
print(hashlib.sha256(b).hexdigest())
