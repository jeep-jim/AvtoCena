import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {PROFILE, sha256} from './release-contract.mjs';

const HOST_SHA = 'fd37f98aab3eeb16f131fcd4033adbb56f7e9616208c2f1ab5ef7a446caa4e4c';
const BUNDLE = Object.freeze([
  '.github/operations/home-ui-only-20261123/inventory.py',
  '.github/operations/home-ui-adapter-20261123/host-primitives.py',
  '.github/operations/ajes-japan-only-20261124/release-host.py',
  '.github/operations/ajes-japan-only-20261124/release-profile.json',
  'scripts/regcloud-performance-gate.py','scripts/regcloud-browser-verdict.py',
  'docs/operations/2026-11-11-accepted-speed-baseline.json',
]);
const METHODS = new Set(['init','image','private-index','resources','fresh','start','identity','aj-private','aj-public',
  'server-private','server-public','switch','public-identity','browser','accept','rollback','cleanup','close']);
const need = (value, code) => { if (!value) throw Error('aj_ssh_' + code); };
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

export async function remoteProgram(root, nonce) {
  need(/^[a-f0-9]{32}$/.test(nonce), 'nonce');
  const files = {};
  for (const name of BUNDLE) {
    const filename = path.join(root, name), raw = await fs.readFile(filename);
    need(await fs.realpath(filename) === filename, 'bundle_path');
    files[name] = {sha256:sha256(raw), base64:raw.toString('base64')};
  }
  const loader = await fs.readFile(path.join(root, '.github/operations/ajes-japan-only-20261124/release-loader.py'), 'utf8');
  need(loader.split('__AJ_CONTROLLER_BUNDLE__').length === 2, 'loader_template');
  return Buffer.from(loader.replace('__AJ_CONTROLLER_BUNDLE__', Buffer.from(JSON.stringify({nonce,source:PROFILE.source,files})).toString('base64')));
}

export function remoteCommand(program) {
  need(Buffer.isBuffer(program) && program.length > 0, 'program');
  const bootstrap = `import hashlib,sys;raw=sys.stdin.buffer.read(${program.length});assert len(raw)==${program.length};assert hashlib.sha256(raw).hexdigest()=='${sha256(program)}';exec(compile(raw,'<exact-aj-controller>','exec'))`;
  // SSH_CONNECTION is copied from sshd's actual peer, never from a runner-selected
  // address. Everything else is cleared before the pinned Python payload runs.
  return '/usr/bin/env -i PATH=/usr/bin:/bin SSH_CONNECTION="$SSH_CONNECTION" /usr/bin/python3 -I -B -c ' + quote(bootstrap);
}

export class AjSshSession {
  constructor({process:child, nonce, authority, browser}) {
    this.child = child; this.nonce = nonce; this.authority = authority; this.browser = browser;
    this.sequence = 0; this.pending = new Map(); this.writes = Promise.resolve(); this.buffer = ''; this.closed = false;
    this.ready = new Promise((resolve,reject) => {this.readyResolve=resolve;this.readyReject=reject;});
    this.ready.catch(()=>{});
    this.exited = new Promise(resolve => child.once('close', (code,signal) => {
      this.closed=true; this.fail(Error('aj_ssh_closed')); resolve({code,signal});
    }));
    child.once('error',()=>this.fail(Error('aj_ssh_transport')));
    child.stdin.on('error',()=>this.fail(Error('aj_ssh_input_failed')));
    child.stderr.on('data',()=>{}); // No raw SSH/remote exceptions in public logs.
    child.stdout.on('data', chunk => {
      this.buffer += chunk.toString('utf8');
      if (Buffer.byteLength(this.buffer) > 4*1024*1024) return this.abort(Error('aj_ssh_output_bound'));
      let newline;
      while ((newline=this.buffer.indexOf('\n')) >= 0) {
        const line=this.buffer.slice(0,newline);this.buffer=this.buffer.slice(newline+1);
        try { this.message(JSON.parse(line)); } catch { this.abort(Error('aj_ssh_protocol')); }
      }
    });
  }

  fail(error) { this.readyReject(error); for(const row of this.pending.values()){row.reject(error);row.readyReject(error);}this.pending.clear(); }
  abort(error) { this.fail(error);this.child.stdin.destroy();this.child.kill('SIGTERM'); }

  send(value) {
    const bytes=Buffer.from(JSON.stringify(value)+'\n');
    this.writes=this.writes.then(async()=>{need(!this.closed,'closed');if(!this.child.stdin.write(bytes))await once(this.child.stdin,'drain');});
    return this.writes;
  }

  message(value) {
    if(value.kind==='ready'){
      need(value.source===PROFILE.source&&value.nonce===this.nonce,'ready_identity');this.readyResolve();return;
    }
    if(value.kind==='authority-request'){
      need(Number.isSafeInteger(value.id)&&value.id>0&&/^[a-z_-]+$/.test(value.phase||''),'authority_request');
      this.authority.guard().then(proof=>this.send({kind:'authority',id:value.id,ok:true,...proof,lockedUntilMs:Date.parse(proof.lockedUntil)}))
        .catch(()=>this.send({kind:'authority',id:value.id,ok:false})).catch(()=>this.abort(Error('aj_ssh_authority_failed')));
      return;
    }
    if(value.kind==='browser-ready'){
      need(value.nonce===this.nonce&&value.release===PROFILE.source&&!this.browserStarted,'browser_identity');
      this.browserStarted=true;
      this.browser().catch(()=>({schemaVersion:1,release:PROFILE.source,nonce:this.nonce,passed:false,
        functionalPassed:false,speedPassed:false,reportSha256:sha256('{}')}))
        .then(verdict=>this.send({kind:'browser-verdict',value:verdict})).catch(()=>this.abort(Error('aj_ssh_browser_transport')));
      return;
    }
    const row=this.pending.get(value.id);need(row,'reply_identity');
    if(value.kind==='upload-ready'){row.readyResolve();return;}
    this.pending.delete(value.id);
    if(value.kind==='result'){row.resolve(value.value);row.readyResolve(false);}
    else if(value.kind==='error'){
      const error=Error(/^(?:home_host_|inventory_)[a-z0-9_:-]+$/.test(value.code||'')?value.code:'aj_ssh_remote_failed');
      row.reject(error);row.readyReject(error);
    }else throw Error('aj_ssh_reply_kind');
  }

  request(method,params={}){
    need(METHODS.has(method),'method');const id=++this.sequence;
    let resolve,reject,readyResolve,readyReject;
    const result=new Promise((yes,no)=>{resolve=yes;reject=no;});
    result.catch(()=>{});
    const ready=new Promise((yes,no)=>{readyResolve=yes;readyReject=no;});ready.catch(()=>{});
    this.pending.set(id,{resolve,reject,readyResolve,readyReject});
    this.send({kind:'call',id,method,params}).catch(error=>{reject(error);readyReject(error);});
    return {id,result,ready};
  }
  call(method,params={}) { return this.request(method,params).result; }

  async upload(method, filename, params={}) {
    need(['image','private-index'].includes(method),'upload_method');
    const request=this.request(method,params);
    let failure;
    request.result.catch(error=>{failure=error;});
    // A private file may already exist with the exact reviewed bytes. Otherwise
    // wait until the host has finished its authority check before sending data;
    // this prevents bounded upload queues from starving an authority reply.
    const begun=await Promise.race([request.ready,request.result.then(()=>false)]);
    if(begun!==false){
      for await(const chunk of createReadStream(filename,{highWaterMark:65536})) {
        if(failure)throw failure;
        await this.send({kind:'chunk',id:request.id,data:chunk.toString('base64')});
      }
      await this.send({kind:'end',id:request.id});
    }
    return request.result;
  }
  async close(){const result=await this.call('close');this.child.stdin.end();const exit=await this.exited;need(exit.code===0,'close_status');return result;}
}

export async function openAjSshSession({root, directory, nonce, authority, browser, spawnImpl=spawn}) {
  const known=path.join(root,'docs/operations/regcloud-staging-known-hosts');
  need(sha256(await fs.readFile(known))===HOST_SHA,'host_pin');
  need(typeof process.env.SSH_PRIVATE_KEY==='string'&&process.env.SSH_PRIVATE_KEY.length>0,'key_missing');
  const key=path.join(directory,'key');
  await fs.writeFile(key,process.env.SSH_PRIVATE_KEY+'\n',{mode:0o600,flag:'wx'});delete process.env.SSH_PRIVATE_KEY;
  const program=await remoteProgram(root,nonce);
  const args=['-F','/dev/null','-T','-i',key,'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','ForwardAgent=no',
    '-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+known,'-o','GlobalKnownHostsFile=/dev/null',
    '-o','UpdateHostKeys=no','-o','ConnectTimeout=10','-o','ClearAllForwardings=yes',
    '-o','ServerAliveInterval=20','-o','ServerAliveCountMax=3','root@151.248.113.177',remoteCommand(program)];
  const child=spawnImpl('/usr/bin/ssh',args,{env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},stdio:['pipe','pipe','pipe']});
  const session=new AjSshSession({process:child,nonce,authority,browser});
  try {if(!child.stdin.write(program))await once(child.stdin,'drain');await session.ready;return session;}
  catch(error){session.abort(error);throw error;}
  finally{await fs.rm(key,{force:true});}
}
