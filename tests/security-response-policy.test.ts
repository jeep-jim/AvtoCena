import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {NextRequest} from 'next/server';
import {middleware} from '../apps/web/middleware';
const require=createRequire(import.meta.url);
test('CRM framing is blocked without restricting the public partner landing',async()=>{
 const rows=await require('../apps/web/next.config.js').headers();
 const crm=rows.find((r:any)=>r.source==='/crm/:path*'&&r.headers.some((h:any)=>h.key==='Content-Security-Policy'));
 assert.ok(crm.headers.some((h:any)=>h.key==='Content-Security-Policy'&&h.value.includes("frame-ancestors 'none'")));
 const global=rows.find((r:any)=>r.source==='/:path*');assert.ok(global.headers.some((h:any)=>h.key==='X-Content-Type-Options'&&h.value==='nosniff'));assert.ok(!global.headers.some((h:any)=>h.key==='X-Frame-Options'));
});
test('production middleware does not accept a session signed with the public development fallback',async()=>{
 const old={node:process.env.NODE_ENV,auth:process.env.AUTH_SECRET,next:process.env.NEXTAUTH_SECRET};
 try{
  process.env.NODE_ENV='production';delete process.env.AUTH_SECRET;delete process.env.NEXTAUTH_SECRET;
  const {createHmac}=await import('node:crypto');
  const payload=Buffer.from(JSON.stringify({id:'attacker',role:'owner',exp:Math.floor(Date.now()/1000)+60})).toString('base64url');
  const cookie=payload+'.'+createHmac('sha256','avtocena-dev-secret-change-me').update(payload).digest('base64url');
  const response=await middleware(new NextRequest('https://avtocena.com/api/crm/inbox',{headers:{cookie:'avtocena_session='+cookie}}));assert.equal(response.status,401);
 }finally{for(const [k,v] of Object.entries({NODE_ENV:old.node,AUTH_SECRET:old.auth,NEXTAUTH_SECRET:old.next}))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
