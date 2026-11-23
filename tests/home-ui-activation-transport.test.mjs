import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {HomeSshSession,remoteProgram,remoteCommand} from '../.github/operations/home-ui-activation-20261123/ssh-session.mjs';
import {HOME_UI,sha256} from '../.github/operations/home-ui-only-20261123/contract.mjs';

const nonce='a'.repeat(32);
function transport(onMessage,browser=async()=>({schemaVersion:1,release:HOME_UI.source,nonce,passed:true,functionalPassed:true,speedPassed:true,reportSha256:'c'.repeat(64)})){
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
  let buffer='';child.stdin.on('data',bytes=>{buffer+=bytes;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);onMessage(JSON.parse(line),emit);}});
  const emit=value=>child.stdout.write(JSON.stringify(value)+'\n');
  child.kill=()=>queueMicrotask(()=>child.emit('close',1,'SIGTERM'));
  child.stdin.on('finish',()=>queueMicrotask(()=>child.emit('close',0,null)));
  const session=new HomeSshSession({process:child,nonce,browser,
    authority:{guard:async()=>({operationId:'home-ui-catalog-a059-'+nonce,generationId:'gen_1_test',acceptedReadModelFingerprint:'b'.repeat(64),lockedUntil:new Date(Date.now()+60000).toISOString()})}});
  emit({kind:'ready',source:HOME_UI.source,nonce});
  return {child,emit,session};
}

test('streamed image waits for the live authority response and preserves exact bytes; session closes cleanly',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'home-transport-'));const data=Buffer.alloc(256*1024+17,37),chunks=[];
  let authoritySeen=false,callId;
  const f=transport((value,emit)=>{
    if(value.kind==='call'&&value.method==='image'){callId=value.id;emit({kind:'authority-request',id:1,phase:'image_load'});}
    else if(value.kind==='authority'){assert.equal(value.ok,true);authoritySeen=true;emit({kind:'upload-ready',id:callId});}
    else if(value.kind==='chunk'){assert.equal(authoritySeen,true);chunks.push(Buffer.from(value.data,'base64'));}
    else if(value.kind==='end')emit({kind:'result',id:value.id,value:{bytes:Buffer.concat(chunks).length}});
    else if(value.kind==='call'&&value.method==='close')emit({kind:'result',id:value.id,value:{closed:true}});
  });
  try{const filename=path.join(directory,'image.tar');await fs.writeFile(filename,data);await f.session.ready;
    assert.equal((await f.session.upload('image',filename,{bytes:data.length})).bytes,data.length);
    assert.deepEqual(Buffer.concat(chunks),data);await f.session.close();
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('remote refusal before upload sends no payload and pending commands reject on transport loss',async()=>{
  let payloads=0;
  const f=transport((value,emit)=>{if(value.kind==='call')emit({kind:'error',id:value.id,code:'home_host_controller_authority'});else payloads++;});
  await assert.rejects(f.session.upload('image','/does-not-exist'),/home_host_controller_authority/);assert.equal(payloads,0);
  f.session.abort(Error('done'));await f.session.exited;
  const g=transport(()=>{});const waiting=g.session.call('fresh');g.child.emit('close',255,null);
  await assert.rejects(waiting,/home_ssh_closed/);
});

test('nonce-bound browser callback supplies actual verdict; stale ready nonce terminates the transport',async()=>{
  let browserCalls=0,verdict;
  const f=transport((value,emit)=>{
    if(value.kind==='call'&&value.method==='browser')emit({kind:'browser-ready',release:HOME_UI.source,nonce});
    if(value.kind==='browser-verdict'){verdict=value.value;emit({kind:'result',id:1,value:verdict});}
    if(value.kind==='call'&&value.method==='close')emit({kind:'result',id:value.id,value:{closed:true}});
  },async()=>{browserCalls++;return {schemaVersion:1,release:HOME_UI.source,nonce,passed:false,functionalPassed:false,speedPassed:false,reportSha256:'d'.repeat(64)};});
  const result=await f.session.call('browser');assert.equal(browserCalls,1);assert.equal(result.passed,false);assert.equal(verdict.nonce,nonce);await f.session.close();
  const g=transport(()=>{});const waiting=g.session.call('browser');g.emit({kind:'browser-ready',release:HOME_UI.source,nonce:'b'.repeat(32)});
  await assert.rejects(waiting,/home_ssh_protocol/);await g.session.exited;
});

test('remote stdin program contains only six verified controller files and a hash-bound fixed command',async()=>{
  const root=path.resolve(fileURLToPath(new URL('..',import.meta.url))),program=await remoteProgram(root,nonce),command=remoteCommand(program);
  assert.ok(command.includes('SSH_CONNECTION="$SSH_CONNECTION"'));assert.ok(command.includes('/usr/bin/python3 -I -B -c'));
  assert.ok(command.includes(sha256(program)));assert.ok(command.includes('sys.stdin.buffer.read('+program.length+')'));
  const text=program.toString();assert.equal(text.includes('__HOME_CONTROLLER_BUNDLE__'),false);
  assert.ok(text.includes("fcntl.LOCK_EX | fcntl.LOCK_NB"));assert.ok(text.includes("root.mkdir(mode=0o700)"));
  assert.equal(command.includes('sshpass'),false);assert.equal(text.includes('YC_OBJECT_STORAGE_SECRET_ACCESS_KEY='),false);
});
