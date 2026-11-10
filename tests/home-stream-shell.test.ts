import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';

// Evaluate the real page with unavailable storage, rather than waiting for a
// timer and assuming that an early HTTP header means the usable shell rendered.
test('home returns the same client shell before any catalog or supplier read completes',async()=>{
 const result=await build({entryPoints:['apps/web/app/(public)/page.tsx'],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime'],plugins:[{name:'home-dependencies',setup(b){
  b.onResolve({filter:/^@\/|^next\/|home\.module\.css$/},a=>({path:a.path,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path.endsWith('.css')?'export default {scope:"home"}':`
   export const createHomePhaseTiming=()=>({measure:(_p,f)=>f(),setGeneration(){}});
   export function BuyerGallery(){return null} export function SpecialRail(){return null}
   export const withAjesCount=async value=>({...value,countIncomplete:false,marketCountInfo:{}});
   export function AjesRail(){return null} export const readAjesRailData=()=>new Promise(()=>{});
   export const WEBSITE_SCHEMA={}; export function DealerCitySync(){return null}
   export const readShowcase=()=>new Promise(()=>{}); export const homeSpecialRail=async()=>null;
   export const readGreenCorner=async()=>({items:[]});export const publicGreenOffer=value=>value;
   export const applyActiveBusinessPricingBatch=async value=>value;
   export const cookies=async()=>({get:()=>undefined});
   export default function HomePageClient(){return null} export function HomeCatalogPayload(){return null}
   export const readHomeCatalogSnapshot=()=>new Promise(()=>{});
  `}));
 }}]});
 const module={exports:{}};
 new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
 const page=(module.exports as any).default;
 let timer:ReturnType<typeof setTimeout>;
 try {
  const tree:any=await Promise.race([page({searchParams:Promise.resolve({city:'Новокузнецк'})}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('shell waited for storage')),1000);})]);
  const find=(value:any):any=>{if(!value)return null;if(value.type?.name==='HomePageClient')return value;return (Array.isArray(value.props?.children)?value.props.children:[value.props?.children]).map(find).find(Boolean);};
  const shell=find(tree);assert.ok(shell);assert.equal(shell.props.initialCity,'Новокузнецк');
  assert.equal(shell.props.initialOffers,undefined);
  assert.equal(shell.props.catalogSlot.type,Symbol.for('react.suspense'));
  assert.equal(shell.props.catalogSlot.props.children.type.name,'HomeCatalog');
  assert.ok(shell.props.dealerGallerySlot);assert.ok(shell.props.specialRailSlot);
 } finally {clearTimeout(timer!);}
});
