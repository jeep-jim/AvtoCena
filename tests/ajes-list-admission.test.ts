import test from 'node:test';
import assert from 'node:assert/strict';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';

test('slow distinct details cannot occupy both list admission slots',async()=>{
 let release!:()=>void,started!:()=>void,active=0,peak=0,details=0;
 const held=new Promise<void>(r=>release=r),first=new Promise<void>(r=>started=r);
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async input=>{
  const sql=new URL(String(input)).searchParams.get('sql')!;active++;peak=Math.max(peak,active);
  try{if(sql.includes("where id=")){details++;started();await held;}return Response.json([]);}finally{active--;}
 }});
 const one=client.read({table:'korea',id:'fixture001'},'203.0.113.1');
 await first;
 const two=client.read({table:'korea',id:'fixture002'},'203.0.113.2');
 const settled=Promise.allSettled([one,two]);
 let timer:ReturnType<typeof setTimeout>;
 try{
  const result=await Promise.race([client.read({table:'korea',page:7},'203.0.113.3'),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('list blocked behind details')),300);})]);
  assert.equal(result.page,7);
  // A make change and its model directory use the same admission as pagination.
  const lexus = await client.read({table:'korea',make:'LEXUS'},'203.0.113.3');
  const models = await client.read({table:'korea',make:'LEXUS',aggregate:'models'},'203.0.113.3');
  assert.equal(lexus.page,1);assert.equal(models.page,1);
  assert.equal(details,1);assert.ok(peak<=2);
 }finally{clearTimeout(timer!);release();await settled;}
});
