import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const slot='__avtocenaLoginParallelReads';
const deferred=()=>{let resolve!:(value?:any)=>void;const promise=new Promise<any>(r=>{resolve=r;});return{promise,resolve};};
async function fixture(entry:string,modules:Record<string,string>){
 const built=await build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'held-login-reads',setup(b){
  b.onResolve({filter:/.*/},args=>args.kind==='entry-point'?undefined:({path:args.path,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>{assert.ok(args.path in modules,'unexpected dependency '+args.path);return{contents:modules[args.path],loader:'js'};});
 }}]});
 return import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
}
function find(node:any,type:string):any{return Array.isArray(node)?node.map(n=>find(n,type)).find(Boolean):node?.type===type?node:find(node?.props?.children||[],type);}

test('login starts the complete dealer preview while appearance is pending and preserves access, prices and URL fields',async()=>{
 const modules:Record<string,string>={
  'react/jsx-runtime':'export const Fragment="Fragment";export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
  '@/components/account/AccountEntrance':'export const AccountEntrance="AccountEntrance";',
  '@/components/layout/PublicHeader':'export const PublicHeader="PublicHeader";',
  '@/lib/dealers/showcase-model':'export const PILOT_DEALER_ID="dealer_topavto";',
  '@/lib/dealers/showcase-store':'export const readPublicFeatures=()=>globalThis.__avtocenaLoginParallelReads.features();export const readShowcase=(id)=>globalThis.__avtocenaLoginParallelReads.showcase(id);export const findDealer=(id)=>globalThis.__avtocenaLoginParallelReads.find(id);',
  '@/lib/dealers/program-store':'export const availableShowcase=s=>globalThis.__avtocenaLoginParallelReads.available(s);',
  '@/lib/dealers/exchange-rate':'export const withDealerRate=s=>globalThis.__avtocenaLoginParallelReads.rate(s);',
  '@/lib/dealers/public-profile':'export const publicDealerProfile=s=>globalThis.__avtocenaLoginParallelReads.profile(s);',
  '@/lib/dealers/public-rail':'export const publicRail=s=>globalThis.__avtocenaLoginParallelReads.rail(s);',
 };
 const {default:LoginPage}=await fixture('apps/web/app/(public)/login/page.tsx',modules);
 try{
  for(const enabled of [true,false]){
   const held=deferred(),calls:string[]=[];
   const stored={profileEnabled:enabled,dealerId:'dealer_topavto'},available={...stored,accessChecked:true},priced={...available,pricing:{usdRub:91},offers:[{id:'offer',marketQuote:{rate:91}}]};
   const appearance={customer:{banner:'same-banner'}},profile={name:'same-dealer'},items=[{id:'offer',price:1500000}];
   (globalThis as any)[slot]={
    features:()=>held.promise,
    showcase:async(id:string)=>{assert.equal(id,'dealer_topavto');calls.push('showcase');return stored;},
    available:async(s:any)=>{assert.equal(s,stored);calls.push('available');return available;},
    rate:async(s:any)=>{assert.equal(s,available);calls.push('rate');return priced;},
    find:async(id:string)=>{assert.equal(id,'dealer_topavto');calls.push('verify');return{status:'verified'};},
    profile:(s:any)=>{assert.equal(s,priced);return profile;},
    rail:(s:any)=>{assert.equal(s,priced);return items;},
   };
   let settled=false;
   const result=LoginPage({searchParams:Promise.resolve({next:['/crm/customers','/unused'],error:['code','unused'],role:['dealer','customer']})}).then((v:any)=>{settled=true;return v;});
   await new Promise(r=>setImmediate(r));
   const started=[...calls],premature=settled;held.resolve({accountAppearance:appearance});
   const rendered=await result,entrance=find(rendered,'AccountEntrance');
   assert.deepEqual(started,enabled?['showcase','available','rate','verify']:['showcase'],'complete independent dealer work must run while appearance is pending');
   assert.equal(premature,false,'do not return partial content');
   assert.equal(entrance.props.appearance,appearance);
   assert.equal(entrance.props.nextPath,'/crm/customers');assert.equal(entrance.props.errorCode,'code');assert.equal(entrance.props.initialRole,'dealer');
   assert.deepEqual(entrance.props.topDealer,enabled?{profile,items,verified:true}:undefined);
  }
  for(const failure of ['features','showcase']){
   const expected=new Error(failure),data:any={features:async()=>({}),showcase:async()=>null};
   data[failure]=async()=>{throw expected;};(globalThis as any)[slot]=data;
   await assert.rejects(LoginPage({searchParams:Promise.resolve({})}),error=>error===expected);
  }
 }finally{delete (globalThis as any)[slot];}
});

test('public dealer quotes and saved rate start together with identical prices, missing-rate and error behavior',async()=>{
 const modules:Record<string,string>={
  './market-offer-server':'export const withMarketQuotes=s=>globalThis.__avtocenaLoginParallelReads.quotes(s);',
  '../data':'export const readDataJson=(key,fallback)=>globalThis.__avtocenaLoginParallelReads.read(key,fallback);export const mutateDataJson=()=>{throw Error("unexpected refresh/write");};',
 };
 const {withDealerRate}=await fixture('apps/web/lib/dealers/exchange-rate.ts',modules);
 try{
  for(const quote of [{value:93,quoteAt:'same-time',source:'same-source'},null]){
   const held=deferred(),calls:string[]=[];
   const original={pricing:{rateMode:'auto',usdRub:80,baseCity:'Москва'},offers:[{id:'market',availability:'market'}]};
   const priced={...original,offers:[{...original.offers[0],marketQuote:{rate:81,input:{customsRub:123}}}]};
   (globalThis as any)[slot]={
    quotes:(s:any)=>{assert.equal(s,original);calls.push('quotes');return held.promise;},
    read:async(key:string)=>{assert.equal(key,'dealers/rates/usdrub.json');calls.push('savedRate');return{quote};},
   };
   const pending=withDealerRate(original);await new Promise(r=>setImmediate(r));
   const started=[...calls];held.resolve(priced);const result=await pending;
   assert.deepEqual(started,['quotes','savedRate'],'saved rate must not wait for market calculations');
   assert.equal(result.offers,priced.offers);
   assert.deepEqual(result.pricing,quote?{...original.pricing,usdRub:93,rateAt:'same-time',rateSource:'same-source'}:original.pricing);
   assert.equal(original.pricing.usdRub,80,'caller data must not be mutated');
  }
  const original={pricing:{rateMode:'manual',usdRub:79},offers:[{availability:'market'}]};
  const priced={...original,offers:[{availability:'market',marketQuote:{rate:88}}]};
  (globalThis as any)[slot]={quotes:async(s:any)=>{assert.equal(s,original);return priced;},read:()=>{throw Error('manual rate must not read quote');}};
  assert.equal(await withDealerRate(original),priced);
  assert.equal(await withDealerRate(original,true),original);
  const stock={pricing:{rateMode:'auto'},offers:[{availability:'stock'}]};
  (globalThis as any)[slot]={quotes:()=>{throw Error('refresh must not recalculate');},read:()=>{throw Error('stock refresh must not read quote');}};
  assert.equal(await withDealerRate(stock,true),stock);
  for(const fail of ['quotes','read']){
   const expected=new Error(fail),state:any={quotes:async(s:any)=>s,read:async()=>({quote:null})};
   state[fail]=async()=>{throw expected;};(globalThis as any)[slot]=state;
   await assert.rejects(withDealerRate(stock),error=>error===expected);
  }
 }finally{delete (globalThis as any)[slot];}
});
