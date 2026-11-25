import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
test('unused-image plan rejects foreign, pinned, referenced and changed objects; exact delete preserves all containers', () => {
  const python = String.raw`
import base64,copy,hashlib,importlib.util,json,tempfile,types
from pathlib import Path
spec=importlib.util.spec_from_file_location('cleanup','scripts/catalog-next/cleanup-unused-images-20261125.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.validate_targets()
def throws(fn,word):
 try:fn()
 except Exception as e:assert word in str(e),(word,str(e))
 else:raise AssertionError('expected '+word)
target=m.TARGETS[0]
def image(expected):
 return {'Id':expected['id'],'Created':expected['created'],'Size':expected['sizeBytes'],'Os':'linux','Architecture':'amd64',
 'Config':{'Labels':{'org.opencontainers.image.source':'https://github.com/jeep-jim/AvtoCena',
 'avtocena.application':'web','org.opencontainers.image.revision':expected['runtimeSha']}},
 'RepoTags':expected['tags'][:],'RepoDigests':['avtocena-china-runtime@'+expected['id']] if expected['digestCount'] else [],
 'RootFS':{'Layers':['sha256:'+'f'*64]}}
row=image(target);policy=types.SimpleNamespace(pinned_image=lambda r:False)
m.validate_image(row,target,set(),policy)
throws(lambda:m.validate_image(row,target,{target['id']},policy),'protected_image')
throws(lambda:m.validate_image(row,target,set(),types.SimpleNamespace(pinned_image=lambda r:True)),'protected_image')
foreign=copy.deepcopy(row);foreign['Config']['Labels']['org.opencontainers.image.source']='https://other.invalid'
throws(lambda:m.validate_image(foreign,target,set(),policy),'image_owner')
changed=copy.deepcopy(row);changed['Id']='sha256:'+'0'*64
throws(lambda:m.validate_image(changed,target,set(),policy),'image_identity')
changed=copy.deepcopy(row);changed['RepoTags'].append('other:latest')
throws(lambda:m.validate_image(changed,target,set(),policy),'image_tags')
changed=copy.deepcopy(row);changed['RepoDigests']=['other@'+target['id']]
throws(lambda:m.validate_image(changed,target,set(),policy),'image_digest_scope')
encoded=json.dumps({'retainedImageId':target['id']}).encode()
proof={'proof':{'hostReceiptBase64':base64.b64encode(encoded).decode(),'hostReceiptSha256':hashlib.sha256(encoded).hexdigest()}}
assert m.referenced_images(proof)=={target['id']}
throws(lambda:m.validate_image(row,target,m.referenced_images(proof),policy),'protected_image')
proof['proof']['hostReceiptSha256']='a'*64
throws(lambda:m.referenced_images(proof),'reference_proof_hash')
rollback={'hostRollbackBase64':base64.b64encode(encoded).decode(),'hostRollbackSha256':hashlib.sha256(encoded).hexdigest()}
assert m.referenced_images({'intent':{'resolution':rollback}})=={target['id']}

with tempfile.TemporaryDirectory() as temporary:
 cfg=Path(temporary)/'nginx';cfg.write_text('unchanged')
 containers={}
 for pin in m.CONTAINER_PINS:
  identifier=pin['idPrefix']+'0'*(64-len(pin['idPrefix']))
  containers[identifier]={'Id':identifier,'Image':pin['imageId'],'Name':'/kept-'+pin['idPrefix'],
   'Config':{'Env':['private=not-printed']},'HostConfig':{},'Mounts':[{'Source':'/protected/'+pin['idPrefix']}],
   'Created':'2026-11-24T00:00:00Z','RestartCount':0,
   'State':{'Running':pin['running'],'Status':'running' if pin['running'] else 'exited','Pid':1 if pin['running'] else 0}}
 images={identifier:{'Id':identifier,'Created':'old','Config':{},'Size':1,'RepoTags':[],'RepoDigests':[]} for identifier in m.OBSERVED_IMAGE_IDS}
 for expected in m.TARGETS:images[expected['id']]=image(expected)
 deletes=[]
 def docker(method,url):
  if method=='DELETE':
   assert url=='/images/'+target['id']+'?force=false&noprune=true'
   deletes.append(url);images.pop(target['id']);return [{'Deleted':target['id']}]
  assert method=='GET'
  if url=='/containers/json?all=1':return [{'Id':key} for key in containers]
  if url=='/images/json?all=1':return [{'Id':key} for key in images]
  if url.startswith('/containers/'):return copy.deepcopy(containers[url.split('/')[2]])
  if url.startswith('/images/'):return copy.deepcopy(images[url.split('/')[2]])
  raise AssertionError(url)
 h=types.SimpleNamespace(CONFIG=cfg,docker=docker,canonical_mounts=lambda rows:sorted(rows,key=lambda row:row['Source']),
  verify_live_reference=lambda *args:None)
 c=object.__new__(m.Cleanup);c.h=h;c.policy=policy;c.authority={'publicationState':{}};c.protected=set()
 c.removed=[];c.sequence=0;c.inflight=False;c.steps=[];c.current={};c.current_nonce='nonce';c.ingress=cfg.read_bytes()
 c.original_containers=copy.deepcopy(containers);c.original_images=copy.deepcopy(images)
 c.container_fingerprints={key:m.container_fingerprint(v,h) for key,v in containers.items()}
 c.image_fingerprints={key:m.image_fingerprint(v) for key,v in images.items()};c.proof_files=[]
 c.check_authority=lambda value:m.need(value==c.authority,'authority_changed');c.free=lambda:1000+100*len(c.removed)
 c.before=c.free();c.fence()
 identifier=next(iter(containers));original=copy.deepcopy(containers[identifier])
 containers[identifier]['Mounts'][0]['Source']='/changed';throws(c.fence,'container_changed');assert not deletes
 containers[identifier]=copy.deepcopy(original);containers[identifier]['State']['Pid']=999;throws(c.fence,'container_changed');assert not deletes
 containers[identifier]=copy.deepcopy(original);containers[identifier]['Config']['Env']=['private=changed'];throws(c.fence,'container_changed')
 containers[identifier]=copy.deepcopy(original)
 images[target['id']]['Size']+=1;throws(c.fence,'image_changed');images[target['id']]['Size']-=1
 msg={'action':'remove','index':0,'authority':c.authority}
 changed=copy.deepcopy(msg);changed['authority']['changed']=True;throws(lambda:c.step(changed),'authority_changed')
 c.protected.add(target['id']);throws(lambda:c.step(msg),'protected_image');c.protected.clear();assert not deletes
 kept=copy.deepcopy(containers);result=c.step(msg)
 assert result['imageId']==target['id'] and result['measuredFreeBytesChange']==100
 assert len(deletes)==1 and containers==kept and len(images)==27 and target['id'] not in images
 assert set(images)==m.OBSERVED_IMAGE_IDS-{target['id']} and not c.inflight
 throws(lambda:c.step(msg),'sequence')
print('exact-image deletion and reference/container guards passed')
`;
  const output = execFileSync('python3', ['-B', '-c', python], {cwd: root, encoding: 'utf8', timeout: 15000});
  assert.match(output, /exact-image deletion and reference\/container guards passed/);
});
