import https from 'node:https';
import fs from 'node:fs';
import {timingSafeEqual} from 'node:crypto';
import {Sessions,SessionError} from './sessions.mjs';
import {openAlice} from './alice.mjs';
const key=process.env.BROWSER_WORKER_KEY;if(!key||key.length<40)throw Error('worker_key_required');
const sessions=new Sessions({open:openAlice,max:2});
let started=Date.now();
const server=https.createServer({cert:fs.readFileSync('/run/browser/cert.pem'),key:fs.readFileSync('/run/browser/key.pem')},async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 try{
  const supplied=String(req.headers.authorization||'').replace(/^Bearer /,'');
  if(Buffer.byteLength(supplied)!==Buffer.byteLength(key)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(key)))throw new SessionError('unauthorized',401);
  if(req.method!=='POST'||req.url!=='/v1')throw new SessionError('not_found',404);
  let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>8192)throw new SessionError('body_too_large',413);chunks.push(chunk);}
  const body=JSON.parse(Buffer.concat(chunks).toString());
  if(body.action==='health'){res.end(JSON.stringify({ok:true,active:sessions.rows.size,uptimeMs:Date.now()-started,release:process.env.RELEASE_SHA||'',maxSessions:2}));return;}
  if(!/^[a-f0-9]{64}$/.test(body.owner)||!/^[a-f0-9-]{36}$/.test(body.id))throw new SessionError('invalid_session');
  let result;
  if(body.action==='create'){
   if(typeof body.prompt!=='string'||body.prompt.length>2500||!body.prompt.includes('https://avtocena.com/cars/offer/'))throw new SessionError('invalid_prompt');
   if(Date.now()>=Number(process.env.PILOT_EXPIRES_AT||0))throw new SessionError('pilot_expired',503);
   result=sessions.create(body.owner,body.id,body.prompt);
  }else if(body.action==='close')result=await sessions.close(body.owner,body.id);
  else if(body.action==='heartbeat')result=sessions.heartbeat(body.owner,body.id);
  else result=await sessions.act(body.owner,body.id,body.action,body);
  if(Buffer.isBuffer(result)){res.setHeader('Content-Type','image/jpeg');res.end(result);}
  else{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));}
 }catch(e){res.statusCode=e.status||500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:e instanceof SessionError?e.message:'worker_request_failed'}));}
});
server.requestTimeout=15000;server.headersTimeout=10000;server.listen(8443,'0.0.0.0');
const timer=setInterval(()=>sessions.sweep().catch(()=>{}),1000);timer.unref();
async function shutdown(){clearInterval(timer);server.close();await sessions.shutdown();process.exit(0);}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
