import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

test('directory includes every eligible dealer and excludes hidden or unavailable profiles',async()=>{
 const dir=await mkdtemp(join(process.cwd(),'node_modules/.dealer-directory-'));
 const mocks:Record<string,string>={
  '@/lib/dealers/showcase-store':`export async function readDealers(){return ['dealer_topavto','avtograd','hidden','expired','pending'].map(id=>({id,status:id==='pending'?'active':'verified'}))} export async function readShowcase(id){return {dealerId:id,name:id,description:'Company',profileEnabled:id!=='hidden',slug:id==='avtograd'?'avtograd':'',offices:[{city:'Бийск'}],logoLight:'',logoDark:'',banner:''}}`,
  '@/lib/dealers/program-store':`export async function availableShowcase(s){return {...s,profileEnabled:!['expired','pending'].includes(s.dealerId)}}`,
  '@/components/dealers/DealerDirectory':`export function DealerDirectory(){return null}`,
 };
 try{
  await build({entryPoints:['apps/web/app/(public)/dealers/page.tsx'],outfile:join(dir,'page.cjs'),bundle:true,platform:'node',format:'cjs',jsx:'automatic',packages:'external',nodePaths:[join(process.cwd(),'node_modules')],plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'fixtures'}:undefined);b.onLoad({filter:/.*/,namespace:'fixtures'},a=>({contents:mocks[a.path]}));}}]});
  const page=createRequire(import.meta.url)(join(dir,'page.cjs')).default;
  const rendered=await page();
  assert.deepEqual(rendered.props.dealers.map((d:any)=>d.id),['dealer_topavto','avtograd']);
  assert.equal(rendered.props.dealers[1].href,'/dealers/avtograd');
  assert.deepEqual(rendered.props.dealers[1].cities,['Бийск']);
 }finally{await rm(dir,{recursive:true,force:true});}
});
