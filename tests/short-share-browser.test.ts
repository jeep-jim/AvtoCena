import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('old Telegram-created links open the exact website calculation without launching Telegram',async()=>{
 const effects:Array<()=>void>=[],replacements:string[]=[],cities:string[]=[];
 const built=await build({entryPoints:['apps/web/components/catalog/ShortShareRedirect.tsx'],bundle:true,platform:'node',format:'cjs',jsx:'automatic',write:false,external:['react','react/jsx-runtime'],plugins:[{name:'city',setup(b){b.onResolve({filter:/selected-city$/},()=>({path:'city',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const adoptSelectionCity=q=>globalThis.__shareCities.push(q);'}));}}]});
 const oldWindow=(globalThis as any).window;
 (globalThis as any).window={location:{origin:'https://avtocena.com',replace:(p:string)=>replacements.push(p)}};
 (globalThis as any).__shareCities=cities;
 try{
  const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)((id:string)=>id==='react'?{useEffect:(f:()=>void)=>effects.push(f)}:require(id),mod,mod.exports);
  const path='/cars/offer/kia-k3-2023--f465d2d55b6690cacb027721?estimate=preserved&dealer=dealer_topavto&share=3';
  for(const mini of [false,true])for(const web of [false,true]){
   const tree=mod.exports.ShortShareRedirect({path,token:'MSv0E5fUgDYlZF4I',mini,web});
   const link=tree.props.children.find((n:any)=>n.type==='a');assert.equal(link.props.href,path);
   effects.pop()!();assert.equal(replacements.at(-1),path);
  }
  assert.deepEqual(cities,[]);
  const selection='/dealers/dealer_topavto?city=%D0%A2%D0%BE%D0%BC%D1%81%D0%BA&model=K3';
  mod.exports.ShortShareRedirect({path:selection,token:'MSv0E5fUgDYlZF4I',mini:false,web:false,selection:true});effects.pop()!();
  assert.equal(replacements.at(-1),selection);assert.deepEqual(cities,[new URL(selection,'https://avtocena.com').search]);
 }finally{if(oldWindow===undefined)delete (globalThis as any).window;else (globalThis as any).window=oldWindow;delete (globalThis as any).__shareCities;}
});
