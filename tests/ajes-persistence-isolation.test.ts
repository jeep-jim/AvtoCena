import test from 'node:test';
import assert from 'node:assert/strict';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
const lot={ID:'test123',MARKA_NAME:'TOYOTA',MODEL_NAME:'TEST',YEAR:'2023',AUCTION_TYPE:'2',STATUS:'Sold',FINISH:'935000',START:'100000',PW:'49'};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('ready supplier pages and new reads do not wait for optional cache writes',async()=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 let reads=0,writes=0,delivered=0;
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async()=>{reads++;return Response.json([lot]);},saveQuery:async()=>{writes++;await gate;}});
 const first=client.read({table:'stats',page:1},'203.0.113.1').then(value=>{delivered++;return value;});
 const second=client.read({table:'stats',page:2},'203.0.113.1').then(value=>{delivered++;return value;});
 try{
  for(let i=0;i<30&&writes<2;i++)await tick();
  assert.equal(writes,2);
  const third=client.read({table:'stats',page:3},'203.0.113.1').then(value=>{delivered++;return value;});
  for(let i=0;i<30&&delivered<3;i++)await tick();
  assert.equal(reads,3,'cache persistence must release supplier admission');
  assert.equal(delivered,3,'valid cars must be available while writes remain pending');
  const values=await Promise.all([first,second,third]);
  assert.deepEqual(values.map(v=>v.items[0].id),['test123','test123','test123']);
 }finally{release();await Promise.allSettled([first,second]);}
 for(let i=0;i<30&&writes<3;i++)await tick();assert.equal(writes,3,'bounded queued snapshots are still persisted');
});

test('optional persistence bounds active writes and queued payloads without dropping valid responses',async()=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 let writes=0,active=0,maxActive=0;
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async()=>Response.json([lot]),saveQuery:async()=>{writes++;active++;maxActive=Math.max(maxActive,active);await gate;active--;}});
 try{for(let page=1;page<=30;page++){const result=await client.read({table:'stats',page},'203.0.113.1');assert.equal(result.items.length,1);}assert.equal(writes,2);}
 finally{release();}
 for(let i=0;i<50&&writes<18;i++)await tick();
 assert.equal(maxActive,2);assert.equal(writes,18,'two active and at most sixteen queued cache writes');
});
