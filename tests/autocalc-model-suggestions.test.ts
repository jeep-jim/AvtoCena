import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);
test('manual model suggestions find Vito even when catalog identity filtering has no match',async()=>{
 const built=await build({entryPoints:['apps/web/app/api/catalog/models/route.ts'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'directory',setup(b){
  b.onResolve({filter:/^@\/lib\/catalog\/(model-directory|encyclopedia-identity-runtime)$/},a=>({path:a.path,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path.endsWith('model-directory')?`export async function readDirectoryModels(){return [{id:'generic',make:'Mercedes-Benz',model:'Mercedes'},{id:'vito',make:'Mercedes-Benz',model:'Vito'},{id:'corolla',make:'Toyota',model:'Corolla'},{id:'kona',make:'Hyundai',model:'Kona'},{id:'x5',make:'BMW',model:'X5'},{id:'x3',make:'BMW',model:'X3'}]}`:`export async function effectiveCatalogEncyclopediaIdentityMode(){throw Error('Catalog mode must not restrict manual suggestions')}`,loader:'js'}));
 }}]});
 const m={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,m,m.exports);
 for(const query of ['Vito','Вито','Mercedes Vito']){
  const response=await m.exports.GET(new Request('https://avtocena.com/api/catalog/models?'+new URLSearchParams({q:query,scope:'autocalc'})));
  assert.equal(response.status,200);const {items}=await response.json();assert.equal(items.length,1);assert.equal(items[0].model,'Vito');assert.equal(items[0].make,'Mercedes-Benz');
 }
 for(const [make,model,queries] of [['Toyota','Corolla',['королла','колрла','corola','korolla']],['Hyundai','Kona',['кона','cona','kona']]] as const){
  for(const q of queries){const response=await m.exports.GET(new Request('https://avtocena.com/api/catalog/models?'+new URLSearchParams({q,make,scope:'autocalc'})));const {items}=await response.json();assert.equal(items[0]?.model,model,q);assert.equal(items[0]?.make,make);assert.equal(items[0]?.powerHp,undefined);}
 }
 for(const [q,make] of [['колрла','Hyundai'],['X4','BMW']]){const response=await m.exports.GET(new Request('https://avtocena.com/api/catalog/models?'+new URLSearchParams({q,make,scope:'autocalc'})));assert.deepEqual((await response.json()).items,[]);}

});
