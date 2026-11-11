import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {build} from 'esbuild';
import {parseChatSession,serializeChatSession} from '../apps/web/lib/autobot/session';

test('old and canonical offer paths survive tab restoration without accepting unsafe paths',()=>{
 for(const value of ['/cars/offer/abc','/cars/offer/model-2024--abc','/cars/offer/abc/model-2024']){
  const result=parseChatSession(serializeChatSession([{role:'assistant',text:'Автомобиль',path:value}],'',true));
  assert.equal(result.messages[0].path,value);
 }
 for(const value of ['https://evil.example/cars/offer/abc','//evil.example/cars/offer/abc','/cars/offer/abc/model/extra','/cars/offer/abc/%2Fsecret','/cars/offer/abc/../crm','/cars/offer/abc?token=private']){
  const result=parseChatSession(serializeChatSession([{role:'assistant',text:'Автомобиль',path:value}],'',true));
  assert.equal(result.messages[0].path,undefined,value);
 }
});

test('short-link social preview resolves stable identity from both URL forms and retains calculation context',async()=>{
 const mocks:Record<string,string>={
  '@/lib/dealers/selection-share-server':"export const readDealerSelection=async()=>null;",
  '@/lib/dealers/selection-share':"export const SELECTION_TITLE='Подборка';",
  'next/navigation':"export const notFound=()=>{throw Error('not_found');};",
  'react':"export const cache=fn=>fn;",
  '@/lib/catalog/short-share':"export const readShortShare=async()=>globalThis.__referenceShortRecord;",
  '@/lib/catalog/offer-metadata':"export async function generateOfferMetadata(input){const {id}=await input.params;const query=await input.searchParams;return {title:id,description:query.calculation,openGraph:{title:id}};}",
  '@/components/catalog/ShortShareRedirect':"export const ShortShareRedirect=()=>null;",
 };
 const compiled=await build({entryPoints:['apps/web/app/(public)/s/[token]/page.tsx'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,jsx:'automatic',plugins:[{name:'reference-share-fixtures',setup(b){
  b.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'fixtures'}:args.path==='@/lib/catalog/offer-url'?{path:path.resolve('apps/web/lib/catalog/offer-url.ts')}:undefined);
  b.onLoad({filter:/.*/,namespace:'fixtures'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
 }}]});
 const module={exports:{} as any};new Function('require','module','exports',compiled.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
 const global=globalThis as any;
 try{
  for(const href of ['/cars/offer/abc/model-2024','/cars/offer/model-2024--abc','/cars/offer/abc']){
   global.__referenceShortRecord={version:1,path:href+'?calculation=saved-version&dealer=pilot',mini:false};
   const metadata=await module.exports.generateMetadata({params:Promise.resolve({token:'1234567890123456'})});
   assert.equal(metadata.title,'abc',href);assert.equal(metadata.description,'saved-version');
   assert.equal(metadata.openGraph.url,'https://avtocena.com/s/1234567890123456');
   assert.equal(metadata.robots.index,false);
  }
 }finally{delete global.__referenceShortRecord;}
});
