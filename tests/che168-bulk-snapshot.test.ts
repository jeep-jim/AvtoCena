import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {archiveChe168Snapshot,readChe168Snapshot,snapshotBinding} from '../scripts/lib/che168-snapshot.mjs';
import {saveChe168Replica,restoreChe168Replica} from '../scripts/lib/che168-replica.mjs';
import {consumeChe168Csv} from '../scripts/lib/che168-csv-stream.mjs';
import {collectAutoApiChe168} from '../scripts/lib/auto-api-che168-client.mjs';
import {publishedIntakeCheckpoint} from '../scripts/lib/catalog-intake-checkpoint.mjs';
import {normalizeAutoApiChe168} from '../apps/web/lib/catalog/auto-api-che168';

class Store {
 data=new Map<string,any>(); binary=new Map<string,Buffer>(); failManifest=false;
 async readJson(k:string,fallback:any){return structuredClone(this.data.get(k)??fallback);}
 async writeJson(k:string,v:any){if(this.failManifest&&k.endsWith('/manifest.json'))throw Error('store_unavailable');this.data.set(k,structuredClone(v));}
 async putBinary(k:string,b:Buffer){this.binary.set(k,Buffer.from(b));}
 async getBinary(k:string){if(!this.binary.has(k))throw Error('missing');return {data:Buffer.from(this.binary.get(k)!)};}
}
const at='2026-10-09T08:09:40.000Z';
const config=(bytes:number)=>({version:1,date:'2026-10-09',filename:'active_offer.csv',host:'https://autobase-barrett.auto-api.com',initialCursor:20,bytes,etag:'"test-etag"',modifiedAt:at,delimiter:'|'});

test('archive resumes verified parts after failed manifest; expired supplier is no longer needed',async()=>{
 const storage=new Store(),raw=Buffer.from('fixture'),c=config(raw.length);let requests=0;
 const fetchImpl=async(url:string,options:any)=>{requests++;assert.equal(options.redirect,'error');assert.equal(options.headers['if-match'],c.etag);assert.equal(options.headers.range,'bytes=0-6');return new Response(raw,{status:206,headers:{etag:c.etag,'content-range':'bytes 0-6/7'}});};
 storage.failManifest=true;await assert.rejects(()=>archiveChe168Snapshot({config:c,storage,password:'secret',fetchImpl}),/store_unavailable/);
 storage.failManifest=false;await archiveChe168Snapshot({config:c,storage,password:'secret',fetchImpl});assert.equal(requests,1);
 await archiveChe168Snapshot({config:c,storage,password:'',fetchImpl:async()=>{throw Error('expired');}});
 const output=[];for await(const b of readChe168Snapshot({config:c,storage}))output.push(b);assert.deepEqual(Buffer.concat(output),raw);
 storage.binary.set([...storage.binary.keys()][0],Buffer.from('corrupt'));
 await assert.rejects(async()=>{for await(const b of readChe168Snapshot({config:c,storage}))void b;});
});
test('wrong range, version, host and authorization refusal fail closed without leaking credentials',async()=>{
 for(const status of [200,403,412]){
  const storage=new Store();let calls=0;
  await assert.rejects(()=>archiveChe168Snapshot({config:config(1),storage,password:'PRIVATE',fetchImpl:async()=>{calls++;return new Response('PRIVATE',{status});}}),/^Error: auto_api_snapshot_(?:http_|range_mismatch)/);
  assert.equal(calls,1);assert.equal(storage.binary.size,0);
 }
 assert.throws(()=>snapshotBinding({...config(1),host:'https://other.test'}),/invalid_snapshot_config/);
});
test('replica checksum and cursor binding reject corruption and mismatched publication state',async()=>{
 const storage=new Store(),root=await fs.mkdtemp(path.join(os.tmpdir(),'che168-replica-test-'));
 try{
  const filename=path.join(root,'base');await fs.writeFile(filename,'sqlite fixture');
  const binding=snapshotBinding(config(1)),descriptor=await saveChe168Replica({storage,filename,binding,cursor:42});
  const restored=path.join(root,'restored');await restoreChe168Replica({storage,filename:restored,descriptor,binding,cursor:42});
  assert.equal(await fs.readFile(restored,'utf8'),'sqlite fixture');
  await assert.rejects(()=>restoreChe168Replica({storage,filename:path.join(root,'other'),descriptor,binding,cursor:43}),/invalid_replica/);
  const key=[...storage.data.keys()][0];storage.data.get(key).parts[0].sha256='0'.repeat(64);
  await assert.rejects(()=>restoreChe168Replica({storage,filename:path.join(root,'bad'),descriptor,binding,cursor:42}),/invalid_replica/);
  const intake={market:'china',provider:'auto_api_che168',completed:true,completedAt:at,sources:[{sourceId:'autohome_used_china_open',provider:'auto_api_che168',rejectedIdentity:0,cursor:42,snapshotBinding:binding,completeInventory:true,replica:descriptor}]};
  assert.equal(publishedIntakeCheckpoint(intake,{published:true,market:'china',generationId:'published'}).sources[0].replica.key,descriptor.key);
  intake.sources[0].replica.cursor=43;assert.throws(()=>publishedIntakeCheckpoint(intake,{published:true,market:'china',generationId:'published'}),/replica_cursor_not_committable/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
const csvQuote=(s:string)=>'"'+s.replaceAll('"','""')+'"';
function csv(year='2022') {
 const row={inner_id:'42',url:'https://www.che168.com/dealer/1/42.html',mark:'Toyota',model:'Corolla | Cross\nUnicode 北京',year,price:'90000',images:JSON.stringify(['https://2sc2.autoimg.cn/escimg/auto/g31/car.jpg']),extra:JSON.stringify({configuration:{specid:123,paramtypeitems:[{name:'发动机',paramitems:[{name:'排量(mL)',value:'1998'}]}]}})};
 return Object.keys(row).join('|')+'\r\n'+Object.values(row).map(csvQuote).join('|')+'\r\n';
}
test('CSV handles pipes, quoted newlines, split Unicode and embedded specifications without extra detail calls',async()=>{
 const raw=Buffer.from('\ufeff'+csv()),rows:any[]=[];
 async function* chunks(){for(let i=0;i<raw.length;i+=7)yield raw.subarray(i,i+7);}
 const report=await consumeChe168Csv({chunks:chunks(),yearFrom:2020,onRow:async(row:any)=>rows.push(row)});
 assert.equal(report.totalRows,1);assert.equal(rows.length,1);assert.match(rows[0].data.model,/北京/);
 const o=normalizeAutoApiChe168(rows[0],at)!;assert.equal(o.engineCc,1998);assert.equal(o.images.length,1);
 for(const malformed of [csv().slice(0,-10),'inner_id|year\n1|2022\n',csv()+'"unfinished']){
  await assert.rejects(()=>consumeChe168Csv({chunks:(async function*(){yield Buffer.from(malformed);})(),yearFrom:2020,onRow:async()=>{}}),/invalid_csv/);
 }
});
test('inline added data followed by price delta and removal needs no per-car request and commits complete pages only',async()=>{
 const requests:string[]=[],events:string[]=[],progress:number[]=[];
 const data={inner_id:'42',url:'https://www.che168.com/dealer/1/42.html'};
 const report=await collectAutoApiChe168({yearFrom:2020,resume:{cursor:20,snapshotStartedAt:at},useChangeData:true,now:()=>at,
  request:async(endpoint:string,p:any)=>{requests.push(endpoint);assert.equal(endpoint,'changes');return {result:p.change_id===20?[
   {id:20,inner_id:'42',change_type:'added',created_at:at,data},
   {id:21,inner_id:'42',change_type:'changed',created_at:at,data:{new_price:123}},
   {id:22,inner_id:'43',change_type:'removed',created_at:at}]:[],meta:{cur_change_id:p.change_id,next_change_id:23}};},
  onOffer:async(row:any,time:string,change:any)=>{assert.equal(time,at);assert.equal(change.id,20);events.push('added');},
  onPriceChange:async(change:any)=>{assert.deepEqual(events,['added']);assert.equal(change.data.new_price,123);events.push('price');return true;},
  onRemoval:async()=>{events.push('removed');},onProgress:async(p:any)=>progress.push(p.cursor),
 });
 assert.deepEqual(requests,['changes','changes']);assert.deepEqual(events,['added','price','removed']);assert.deepEqual(progress,[23]);assert.equal(report.cursor,23);
});

test('real intake entrypoint bootstraps CSV, applies changes, then restores only its committed replica',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'che168-bulk-integration-')),storage=new Store(),raw=Buffer.from(csv()),c=config(raw.length);
 await archiveChe168Snapshot({config:c,storage,password:'fixture',fetchImpl:async()=>new Response(raw,{status:206,headers:{etag:c.etag,'content-range':`bytes 0-${raw.length-1}/${raw.length}`}})});
 const objects=new Map<string,Buffer>();
 for(const [key,value] of storage.data)objects.set('/bucket/'+key,Buffer.from(JSON.stringify(value)));
 for(const [key,value] of storage.binary)objects.set('/bucket/'+key,value);
 const server=http.createServer(async(req,res)=>{
  const key=decodeURIComponent(new URL(req.url!,'http://localhost').pathname),old=objects.get(key);
  const etag=(b:Buffer)=>'"'+createHash('sha256').update(b).digest('hex')+'"';
  if(req.method==='PUT'){
   if(req.headers['if-none-match']==='*'&&old||req.headers['if-match']&&(!old||req.headers['if-match']!==etag(old))){res.writeHead(412);res.end();return;}
   const parts=[];for await(const part of req)parts.push(part);const data=Buffer.concat(parts);objects.set(key,data);res.writeHead(200,{etag:etag(data)});res.end();
  }else if(old){res.writeHead(200,{etag:etag(old)});res.end(old);}else{res.writeHead(404);res.end();}
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const endpoint=`http://127.0.0.1:${(server.address() as any).port}`,configPath=path.join(root,'config.json'),hook=path.join(root,'api.mjs');
 await fs.writeFile(configPath,JSON.stringify(c));
 await fs.writeFile(hook,`const realFetch=globalThis.fetch;globalThis.fetch=async(input,options)=>{const u=new URL(String(input));if(u.hostname!=='api1.auto-api.com')return realFetch(input,options);if(!u.pathname.endsWith('/changes'))throw Error('unexpected_per_car_request');const cursor=Number(u.searchParams.get('change_id')),at=${JSON.stringify(at)};const event=(id,inner_id,change_type,data)=>({id,inner_id,change_type,created_at:at,data});const full=id=>({inner_id:id,url:'https://www.che168.com/dealer/1/'+id+'.html',mark:'Toyota',model:'Corolla',year:2022,price:90000});const second=process.env.SECOND==='1';const result=!second&&cursor===20?[event(20,'43','added',full('43')),event(21,'42','changed',{new_price:123}),event(22,'43','removed')]:second&&cursor===23?[event(23,'42','changed',{new_price:456}),event(24,'44','added',full('44'))]:[];return Response.json({result,meta:{cur_change_id:cursor,next_change_id:second?25:23}});};`);
 async function run(second=false){
  const directory=path.join(root,second?'second':'first');
  const child=spawn(process.execPath,['--import','tsx','--import',hook,'scripts/catalog-auto-api-che168-bulk-intake.mjs'],{env:{...process.env,JSON_STORAGE_DRIVER:'object',YC_OBJECT_STORAGE_ENDPOINT:endpoint,YC_OBJECT_STORAGE_BUCKET:'bucket',YC_OBJECT_STORAGE_ACCESS_KEY_ID:'fixture',YC_OBJECT_STORAGE_SECRET_ACCESS_KEY:'fixture',YC_OBJECT_STORAGE_PREFIX:'',AUTO_API_CHE168_KEY:'fixture',CHE168_SNAPSHOT_CONFIG:configPath,AUTO_API_INTAKE_DIR:directory,SECOND:second?'1':'0'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  assert.equal(await new Promise(resolve=>child.on('close',resolve)),0,output);
  const report=JSON.parse(await fs.readFile(path.join(directory,'report.json'),'utf8')),offers=[];
  for(const f of await fs.readdir(directory))if(f.endsWith('.jsonl'))for(const line of (await fs.readFile(path.join(directory,f),'utf8')).trim().split('\n'))offers.push(JSON.parse(line).offer);
  return {report,offers};
 }
 try{
  const first=await run();assert.equal(first.report.completed,true);assert.equal(first.offers.length,1);assert.equal(first.offers[0].sourcePrice,123);assert.equal(first.offers[0].sourceOfferId,'42');
  assert.equal(first.offers[0].operational.che168ActiveVerification.cursor,23);
  const checkpoint=publishedIntakeCheckpoint(first.report,{published:true,market:'china',generationId:'fixture'});
  objects.set('/bucket/catalog/intake-cursors/v1/china.json',Buffer.from(JSON.stringify(checkpoint)));
  // Remove the initial CSV: a normal update must use the committed replica.
  for(const key of objects.keys())if(key.includes('/provider-snapshots/'))objects.delete(key);
  const second=await run(true);assert.equal(second.report.sources[0].pages,0);assert.equal(second.offers.length,2);
  assert.equal(second.offers.find(o=>o.sourceOfferId==='42').sourcePrice,456);assert.equal(second.report.sources[0].cursor,25);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await fs.rm(root,{recursive:true,force:true});}
});
