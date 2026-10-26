import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('public preview refresh retains learned prices and gives explicit saved calculations priority',async()=>{
 const mocks:any={
 'next/server':`export const NextResponse={json:(v,o)=>Response.json(v,o)};`,
 'management-knowledge':`export const readManagementKnowledge=async()=>({models:{honda:{}}});`,
 'management-previews':`export const attachManagementPreviews=async rows=>rows.map(r=>({...r,savedCalculationPreview:{managementLearned:true,totalRub:1234567,parameters:{powerHp:150}}}));`,
 'offer-page-data':`export const getOfferForPage=async id=>({id,market:'china',sourceId:'feed'});`,
 'green-corner':`export const getGreenCornerOffer=async()=>null;`,
 'saved-offer-calculation':`export const getSavedOfferCalculation=async()=>null;`,
 'saved-calculation-previews':`export const savedPreviewEntry=()=>null;export const readSavedPreviewIndex=async()=>({entries:{explicit:{market:'china',sourceId:'feed',preview:{totalRub:2222222,parameters:{powerHp:170}}}}});`
 };
 const built=await build({entryPoints:['apps/web/app/api/catalog/saved-previews/route.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,plugins:[{name:'fixture',setup(b){b.onResolve({filter:/.*/},a=>{const key=a.path==='next/server'?a.path:a.path.split('/').at(-1)!;return mocks[key]?{path:key,namespace:'fixture'}:undefined});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path]}));}}]});
 const module={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,module,module.exports);
 const response=await module.exports.GET(new Request('https://avtocena.com/api/catalog/saved-previews?ids=learned,explicit'));
 const data=await response.json();assert.equal(data.previews.learned.preview.managementLearned,true);assert.equal(data.previews.learned.preview.parameters.powerHp,150);assert.equal(data.previews.explicit.preview.parameters.powerHp,170);assert.doesNotMatch(JSON.stringify(data),/savedBy|models|revision/);
 assert.equal((await module.exports.GET(new Request('https://avtocena.com/api/catalog/saved-previews?ids='+Array.from({length:51},(_,i)=>'id'+i).join(',')))).status,400);
});
