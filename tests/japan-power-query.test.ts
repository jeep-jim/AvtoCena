import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {builtinModules} from 'node:module';
import {build} from 'esbuild';
import {ajesQuery,ajesLot} from '../apps/web/lib/catalog/ajes-query';
import {japanPowerCandidateSql} from '../apps/web/lib/catalog/japan-power-query';
import {japanPowerSnapshot} from '../apps/web/lib/catalog/ajes-power-page';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {ajesResultFilter} from '../apps/web/lib/catalog/ajes-result-filter';
import {enrichJapanDrive} from '../apps/web/lib/catalog/japan-drive';
import {japanUnknownPower} from '../apps/web/lib/catalog/japan-source-power';
import type {CalculationIndex} from '../apps/web/lib/encyclopedia/calculation-index';
const fact=(model:string,year=2020)=>({modelId:model,variantId:model,revision:'fixture',year,trims:[],constraints:{},values:{powerHp:150},sources:{powerHp:{kind:'manufacturer' as const}}});
const index:CalculationIndex={version:1,digest:'index-1',manifestDigest:'fixture',createdAt:'2026-11-26',models:{'honda:fit':[fact('FIT')],'toyota:corolla':[fact('COROLLA')]}};
const editorial:any={revision:'editorial-1',entries:{'ajes-stats-manual':{id:'ajes-stats-manual',sourceId:'ajes_japan_feed',sourceOfferId:'manual',market:'japan',status:'visible',specifications:{powerHp:130}}}};
const snapshot=japanPowerSnapshot(index,editorial);
test('actual photo galleries remain browser-bundleable without server snapshot dependencies',async()=>{
 assert.equal(snapshot.revision,'9967105b7a5377e44d2bde8066012c2f5fb22d4914415e9697cf13ec6f62e636','snapshot identity is unchanged by its server-only relocation');
 const entries=['apps/web/components/catalog/PhotoBrowser.tsx','apps/web/components/catalog/VehicleGallery.tsx'];
 const built=await build({entryPoints:entries,outdir:'/tmp/avtocena-browser-bundle-guard',bundle:true,platform:'browser',format:'esm',write:false,jsx:'automatic',tsconfig:'apps/web/tsconfig.json',metafile:true,logLevel:'silent'});
 for(const path of entries)assert.ok(built.metafile.inputs[path],path);
 assert.ok(built.metafile.inputs['apps/web/lib/catalog/ajes-query.ts']);
 assert.equal(Object.keys(built.metafile.inputs).some(path=>path.endsWith('/ajes-power-page.ts')),false);
 const imports=[...Object.values(built.metafile.inputs),...Object.values(built.metafile.outputs)].flatMap(entry=>entry.imports);
 assert.deepEqual(imports.filter(entry=>entry.path.startsWith('node:')||builtinModules.includes(entry.path)),[],'browser graph must contain no Node builtins, including external imports');
 assert.equal(built.outputFiles.filter(file=>file.path.endsWith('.js')).length,2);
});
function select(phase:'known'|'unknown',values:{id:string;pw?:unknown;model?:string;year?:number}[],compact=false){
 const db=new DatabaseSync(':memory:');db.function('regexp',(pattern,value)=>value===null?null:Number(new RegExp(String(pattern),'i').test(String(value))));
 db.exec('create table cars(id text,pw text,model_name text,year integer)');
 const insert=db.prepare('insert into cars values(?,?,?,?)');for(const row of values)insert.run(row.id,row.pw==null?null:String(row.pw),row.model||'OTHER',row.year||2020);
 const sql=japanPowerCandidateSql({powerTo:160},{phase,snapshot},compact);
 try{return db.prepare('select id from cars where '+sql+' order by id').all().map(row=>String(row.id));}finally{db.close();}
}
test('known source candidates retain scalar PW, every possible local donor and owner/manual overrides',()=>{
 const rows=[{id:'wire',pw:'160'},{id:'over',pw:'161'},{id:'local-over',pw:'250',model:'FIT'},{id:'local-empty',pw:'',model:'C-O R O L L A'},
  {id:'manual',pw:'300'},{id:'owner',pw:'190',model:' STEP WAGON SPADA'},{id:'entity',pw:'&#49;50'},{id:'nfkc',pw:'１５０'},
  {id:'identity',pw:'',model:'ＦＩＴ'},{id:'unknown',pw:''},{id:'bad',pw:'100,200'}];
 assert.deepEqual(select('known',rows),['bad','entity','identity','local-empty','local-over','manual','nfkc','owner','wire']);
 assert.deepEqual(select('unknown',rows),['bad','entity','identity','local-empty','nfkc','unknown']);
 const compact=new Set(select('known',rows,true));for(const id of select('known',rows))assert.ok(compact.has(id),'compact predicate is a superset: '+id);
});
test('unknown phase retains zero, malformed, unsafe and oversized power without coercing it into a fact',()=>{
 const rows=[null,'','0','150,200','160.5','1e2','9007199254740992','0'.repeat(31)+'150','160','00160','9007199254740991'].map((pw,i)=>({id:String(i).padStart(2,'0'),pw}));
 assert.deepEqual(select('unknown',rows),['00','01','02','03','04','05','06','07']);
});
test('phase is server-owned and list/count bind the identical candidate predicate before ORDER BY and LIMIT',()=>{
 for(const phase of ['known','unknown'] as const){
  const context={phase,snapshot},query={powerTo:160,fuel:'petrol',page:2,pageSize:48};
  const list=ajesQuery(query,index,context).sql,count=ajesQuery({...query,aggregate:'count'},index,context).sql;
  assert.equal(list.slice(list.indexOf(' where '),list.indexOf(' order by ')),count.slice(count.indexOf(' where ')));
  assert.match(list,/order by auction_date desc, id asc limit 48,48$/);
  assert.ok(new URLSearchParams({sql:list}).toString().length<6000);
 }
 assert.throws(()=>ajesQuery({powerTo:160,phase:'unknown'}),/ajes_invalid_query/);
 assert.throws(()=>ajesQuery({},index,{phase:'known',snapshot}),/ajes_invalid_query/);
});
test('large or unusual private index predicates broaden safely within the existing URI budget',()=>{
 const large={...index,models:Object.fromEntries(Array.from({length:1200},(_,i)=>[`brand:model${i}`,[fact(`MODEL${i}`,2008+i%19)]]))};
 for(const drive of [undefined,'awd','fwd','rwd']){
  const context={phase:'known' as const,snapshot:japanPowerSnapshot(large,editorial)};
  const sql=ajesQuery({powerTo:160,drive,pageSize:48},large,context).sql;
  assert.ok(new URLSearchParams({sql}).toString().length<6000,String(drive));
  assert.ok(/year>=2008 and year<=2026/.test(sql)||/ and 1=1 order by /.test(sql),'all potential local years remain or the whole bounded candidate set is retained');
 }
});
test('transport fallback retains every candidate instead of truncating local overrides; proof COUNT stays identical',()=>{
 const large={...index,models:Object.fromEntries(Array.from({length:1200},(_,i)=>[`brand:model${i}`,[fact(`MODEL${i}`,2008+i%19)]]))};
 const context={phase:'known' as const,snapshot:japanPowerSnapshot(large,editorial)};
 const q={powerTo:160,drive:'fwd',fuel:'petrol',make:'Toyota',model:'COROLLA FIELDER EXTRA LONG REVIEWED FAMILY',yearFrom:2014,yearTo:2026,engineTo:2000,pageSize:48};
 const list=ajesQuery(q,large,context).sql,count=ajesQuery({...q,aggregate:'count'},large,context).sql;
 assert.match(list,/ and 1=1 order by /);assert.doesNotMatch(list,/\bpw\b/);
 assert.equal(list.slice(list.indexOf(' where '),list.indexOf(' order by ')),count.slice(count.indexOf(' where ')));
 assert.ok(new URLSearchParams({sql:list}).toString().length<6000);
});
test('empty phase validation uses its exact snapshot COUNT and cannot borrow an ordinary total',async()=>{
 const queries:string[]=[];
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},calculationIndex:()=>null,
  fetcher:async url=>{const sql=new URL(String(url)).searchParams.get('sql')!;queries.push(sql);return Response.json(sql.startsWith('select count(*)')?[{total:0}]:[]);}});
 const result=await client.read({powerTo:160,pageSize:48},'203.0.113.1',{phase:'known',snapshot});
 assert.equal(result.received,0);assert.equal(result.emptyPageEvidence.countTotal,0);assert.equal(queries.length,2);
 assert.equal(queries[0].slice(queries[0].indexOf(' where '),queries[0].indexOf(' order by ')),queries[1].slice(queries[1].indexOf(' where ')));
 assert.match(queries[1],/manual/,'COUNT keeps the exact editorial context');
});
test('all three drives keep a bounded source query and the final local drive/power rules',()=>{
 for(const drive of ['awd|fwd|rwd','rwd|awd|fwd|awd'])for(const phase of ['known','unknown'] as const){
  const q={drive,powerTo:160,fuel:'petrol',yearFrom:2014,yearTo:2026,engineTo:2000,pageSize:48},context={phase,snapshot};
  const list=ajesQuery(q,index,context).sql,count=ajesQuery({...q,aggregate:'count'},index,context).sql;
  assert.ok(new URLSearchParams({sql:list}).toString().length<6000);
  assert.doesNotMatch(list,/\bpriv\b|\bkuzov\b/,'all-drive source candidates do not repeat the chassis registry');
  assert.equal(list.slice(list.indexOf(' where '),list.indexOf(' order by ')),count.slice(count.indexOf(' where ')));
 }
 assert.throws(()=>ajesQuery({drive:'awd|fwd|rwd|invalid',powerTo:160}),/ajes_invalid_query/);
 for(const drive of ['awd','fwd|rwd'])assert.match(ajesQuery({drive,powerTo:160}).sql,/\bpriv\b/,'a proper subset keeps its existing source predicate');
 const offer=(id:string,pw:string,drive?:string,powerHp?:number)=>({id:`ajes-stats-${id}`,sourceId:'ajes_japan_feed',market:'japan',make:'Toyota',model:'TEST',fuel:'petrol',drive,powerHp,operational:{raw:{sourcePower:pw}}});
 const locallyEnriched=enrichJapanDrive({...offer('local-drive','150'),make:'Honda',model:'CR-V',year:2020,chassisCode:'RE4'});
 assert.equal(locallyEnriched.drive,'awd');
 const rows=[offer('manual','250','fwd',150),offer('supplier','140','rwd'),offer('unknown-power','','awd'),locallyEnriched,
  offer('over','180','fwd'),offer('manual-over','150','rwd',180),offer('unknown-drive','150'),offer('unknown-both','')];
 const filter=ajesResultFilter({market:'japan',drive:'awd|fwd|rwd',powerTo:160,fuel:'petrol'}),selected=rows.filter(filter.matches);
 assert.deepEqual(selected.map(row=>row.id),['ajes-stats-manual','ajes-stats-supplier','ajes-stats-unknown-power','ajes-stats-local-drive']);
 assert.deepEqual(selected.filter(japanUnknownPower).map(row=>row.id),['ajes-stats-unknown-power']);
});
