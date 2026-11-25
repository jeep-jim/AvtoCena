import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
test('exact failed-copy cleanup preserves current and proofs, rejects mounted/accepted/symlink/changed targets', () => {
  const source = String.raw`
import importlib.util,json,hashlib,os,tempfile,types,datetime,sys
from pathlib import Path
p=Path('scripts/catalog-next/cleanup-photo-failed-20261125.py')
s=importlib.util.spec_from_file_location('clean',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def throws(fn,word):
 try:fn()
 except Exception as e:
  assert word in str(e),(word,str(e))
 else:raise AssertionError('expected '+word)
throws(lambda:m.validate_targets([]),'target_count')
throws(lambda:m.validate_targets([{'attemptHash':'../bad','controllerSha':next(iter(m.CONTROLLERS)),'planSha256':'a'*64}]),'target_identity')
assert not m.disjoint(Path('/a/b'),[Path('/a')])
assert not m.disjoint(Path('/a'),[Path('/a/b')])
assert m.disjoint(Path('/a/b'),[Path('/a/c')])
with tempfile.TemporaryDirectory() as temp:
 base=Path(temp);current=base/'current';target=base/'failed'
 for d in (current,target):
  (d/'generation').mkdir(parents=True)
  (d/'PLAN.json').write_text('{}')
 (current/'ACCEPTED.json').write_text('{}');(target/'ROLLED_BACK.json').write_text('{}')
 source=current/'generation'/'details.sqlite';source.write_bytes(b'accepted-data')
 dest=target/'generation'/'details.sqlite';dest.write_bytes(source.read_bytes())
 config=base/'nginx';config.write_text('unchanged')
 live={'Id':'live','unchanged':True}
 mounted=[]
 def regular(path,maximum=None):
  st=path.lstat()
  m.need(path.is_file() and not path.is_symlink() and st.st_nlink==1,'regular')
  if maximum is not None:m.need(st.st_size<=maximum,'size')
  return st
 def private(path):m.need(path.is_dir() and not path.is_symlink(),'directory')
 def docker(method,url):
  if url=='/containers/json?all=1':return [{'Id':'live'}]
  return dict(live,Mounts=[{'Source':str(v)} for v in mounted])
 h=types.SimpleNamespace(BASE=base,CONFIG=config,regular=regular,private_directory=private,
  docker=docker,protected_identity=lambda row:{k:row[k] for k in live},file_sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest(),
  verify_live_reference=lambda *a:live)
 c=object.__new__(m.Cleanup);c.h=h;c.authority={};c.check_authority=lambda a:None
 c.live_id='live';c.live_identity=live;c.ingress=config.read_bytes();c.protected=[current]
 c.current={};c.current_nonce='x';c.source_files={'details.sqlite':(source,m.identity(source.stat()))}
 c.proofs=[(current/'PLAN.json',h.file_sha(current/'PLAN.json')),(target/'PLAN.json',h.file_sha(target/'PLAN.json')),
           (target/'ROLLED_BACK.json',h.file_sha(target/'ROLLED_BACK.json'))]
 expected=m.identity(dest.stat());size=dest.stat().st_size
 c.targets=[(target,dest,{'bytes':size},expected)];c.sequence=0;c.deleted=0;c.absent=0;c.logical=0;c.before=c.free()
 msg={'action':'unlink','index':0,'authority':{}}
 mounted.append(target/'generation');throws(lambda:c.step(msg),'target_mounted');assert dest.exists();mounted.clear()
 (target/'ACCEPTED.json').write_text('{}');throws(lambda:c.step(msg),'accepted_changed');assert dest.exists();(target/'ACCEPTED.json').unlink()
 original=dest.read_bytes();dest.unlink();dest.symlink_to(source);throws(lambda:c.step(msg),'regular');assert source.read_bytes()==original;dest.unlink()
 dest.write_bytes(original);c.targets=[(target,dest,{'bytes':size},m.identity(dest.stat()))]
 (target/'PLAN.json').write_text('{"tampered":true}');throws(lambda:c.step(msg),'proof_changed');assert dest.exists();(target/'PLAN.json').write_text('{}')
 step=c.step(msg);assert step['deleted'] is True and step['logicalBytesUnlinked']==size
 assert not dest.exists() and source.read_bytes()==original and (target/'PLAN.json').exists() and (target/'ROLLED_BACK.json').exists()
 result=c.finish({'action':'finish','authority':{}});assert result['completed'] and result['filesDeleted']==1
 assert all(result[k]==0 for k in ('imagesDeleted','containersDeleted','directoriesDeleted','acceptedStateWrites','intentStateWrites'))
 throws(lambda:c.step(msg),'sequence')
print('guarded filesystem cases passed')
`;
  const result = execFileSync('python3', ['-B', '-c', source], {cwd: root, encoding: 'utf8', timeout: 10000});
  assert.match(result, /guarded filesystem cases passed/);
});
