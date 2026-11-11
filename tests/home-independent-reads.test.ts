import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const compiled=build({entryPoints:['apps/web/app/(public)/page.tsx'],bundle:true,platform:'node',format:'cjs',
  write:false,jsx:'automatic',packages:'external',plugins:[{name:'home-dependencies',setup(b){
    b.onResolve({filter:/^(?:@\/|next\/headers$|\.\/home\.module\.css$)/},args=>({path:args.path,external:true}));
  }}]});

function deferred<T>() {
  let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
type Gate='dealer'|'snapshot'|'counts'|'green'|'greenPricing'|'catalogPricing'|'dealerRail';

async function fixture(blocked:Gate[]=[],cookieCity=encodeURIComponent('Новокузнецк')) {
  const gates=Object.fromEntries(['dealer','snapshot','counts','green','greenPricing','catalogPricing','dealerRail']
    .map(name=>[name,deferred<any>()])) as Record<Gate,ReturnType<typeof deferred<any>>>;
  const events:string[]=[],errors:any[][]=[],priceCalls:{phase:string;items:any[]}[]=[],countCalls:any[]=[],railCalls:any[][]=[],publicCalls:any[]=[];
  const snapshot={generationId:'gen_fixture',items:[{id:'before-ajes',totalRub:100}],marketCounts:{china:1},total:1};
  const catalog={...snapshot,items:[{id:'ajes-replacement',totalRub:200},{id:'retained',totalRub:300}],
    marketCounts:{china:23,korea:7},total:30,countIncomplete:false,marketCountInfo:{china:{complete:true}}};
  const green={items:Array.from({length:12},(_,i)=>({id:`green-${i}`,totalRub:400+i}))};
  const dealer={buyersEnabled:true,buyerPhotos:[{url:'https://example.test/buyer.jpg'}]};
  const rail={items:[{id:'special'}],title:'Specials'};
  let measuring='';
  const priced=(items:any[],phase:string)=>items.map(item=>({...item,pricedBy:phase}));
  const value=(name:Gate,fallback:any)=>blocked.includes(name)?gates[name].promise:Promise.resolve(fallback);
  function HomePageClient(){return null;}
  function SpecialRail(){return null;}
  function BuyerGallery(){return null;}
  const dependencies:Record<string,any>={
    '@/lib/catalog/home-phase-timing':{createHomePhaseTiming:()=>({
      setGeneration:(generation:string)=>events.push('generation:'+generation),
      async measure(phase:string,work:()=>any){
        events.push(phase);const previous=measuring;measuring=phase;
        try{return work();}finally{measuring=previous;}
      },
    })},
    'next/headers':{cookies:async()=>({get:(name:string)=>name==='avtocena_city'?{value:cookieCity}:undefined})},
    '@/lib/dealers/showcase-store':{readShowcase:(id:string)=>{assert.equal(id,'dealer_topavto');return value('dealer',dealer);}},
    '@/lib/dealers/public-showcase':{homeSpecialRail:(...args:any[])=>{railCalls.push(args);return value('dealerRail',rail);}},
    '@/lib/catalog/storage':{readHomeCatalogSnapshot:(limit:number)=>{assert.equal(limit,10);return value('snapshot',snapshot);}},
    '@/lib/catalog/ajes-catalog':{withAjesCount:(input:any)=>{countCalls.push(input);return value('counts',catalog);}},
    '@/lib/catalog/green-corner':{
      readGreenCorner:()=>value('green',green),
      publicGreenOffer:(input:any)=>{publicCalls.push(input);return {...input,publicGreen:true};},
    },
    '@/lib/catalog/live-business-pricing':{applyActiveBusinessPricingBatch:(items:any[])=>{
      const phase=measuring;assert.ok(phase==='greenPricing'||phase==='catalogPricing');
      priceCalls.push({phase,items});return value(phase,priced(items,phase));
    }},
    '@/components/home/HomePageClient':HomePageClient,
    '@/components/home/BuyerGallery':{BuyerGallery},
    '@/components/dealers/SpecialRail':{SpecialRail},
    '@/components/dealers/DealerCitySync':{DealerCitySync:()=>null},
    '@/components/catalog/AjesRail':{AjesRail:()=>null,readAjesRailData:async()=>null},
    '@/lib/catalog/search-metadata':{WEBSITE_SCHEMA:{'@type':'WebSite'}},
    './home.module.css':{scope:'home-scope'},
  };
  const module={exports:{} as any};
  new Function('require','module','exports','console',(await compiled).outputFiles[0].text)(
    (name:string)=>Object.hasOwn(dependencies,name)?dependencies[name]:require(name),module,module.exports,
    {...console,error:(...args:any[])=>{errors.push(args);}});
  function client(tree:any):any {
    if(Array.isArray(tree)){for(const child of tree){const found=client(child);if(found)return found;}return null;}
    if(!tree?.props)return null;
    return tree.type===HomePageClient?tree:client(tree.props.children);
  }
  return {render:module.exports.default,client,gates,events,errors,priceCalls,countCalls,railCalls,publicCalls,
    snapshot,catalog,green,dealer,rail,priced,SpecialRail,BuyerGallery};
}
const page=(f:Awaited<ReturnType<typeof fixture>>,city?:string|string[])=>
  f.render({searchParams:Promise.resolve(city===undefined?{}:{city})});
const child=(slot:any)=>slot.props.children;

test('green pricing and dealer rail start while catalog is blocked, and AJES replacement is priced afterward',async()=>{
  const f=await fixture(['snapshot','counts','catalogPricing']);let complete=false;
  const pending=page(f,'  <Москва>"  ').then((tree:any)=>{complete=true;return tree;});
  await turn();
  assert.ok(f.events.includes('greenPricing'));assert.ok(f.events.includes('dealerRail'));
  assert.equal(f.events.includes('counts'),false);assert.equal(f.events.includes('catalogPricing'),false);
  assert.equal(complete,false);assert.equal(f.railCalls.length,1);
  assert.equal(f.railCalls[0][0],'Москва');assert.equal(f.railCalls[0][1],f.dealer);
  f.gates.snapshot.resolve(f.snapshot);await turn();
  assert.equal(f.countCalls[0],f.snapshot);assert.equal(f.events.includes('catalogPricing'),false);
  assert.deepEqual(f.events.filter(event=>event.startsWith('generation:')),['generation:gen_fixture']);
  f.gates.counts.resolve(f.catalog);await turn();
  const call=f.priceCalls.find(call=>call.phase==='catalogPricing')!;
  assert.equal(call.items,f.catalog.items);assert.equal(call.items[0].id,'ajes-replacement');
  assert.equal(complete,false);
  f.gates.catalogPricing.resolve(f.priced(f.catalog.items,'catalogPricing'));
  const props=f.client(await pending).props;
  assert.deepEqual(props.initialOffers,f.priced(f.catalog.items,'catalogPricing'));
  assert.equal(props.initialMarketCounts,f.catalog.marketCounts);assert.equal(props.initialMarketCountInfo,f.catalog.marketCountInfo);
  assert.equal(props.initialCount,42);assert.equal(props.initialCountIncomplete,false);assert.equal(props.initialCity,'Москва');
  assert.deepEqual(f.publicCalls,f.green.items.slice(0,10));
  assert.deepEqual(props.initialGreen,{items:f.priced(f.green.items.slice(0,10).map(item=>({...item,publicGreen:true})),'greenPricing'),total:12});
  const specials=child(props.specialRailSlot),rendered=await specials.type(specials.props);
  assert.equal(rendered.type,f.SpecialRail);assert.deepEqual(rendered.props,{...f.rail,desktopSplit:true});
  await specials.type(specials.props);assert.equal(f.railCalls.length,1,'render consumes one prepared rail promise');
  const gallery=child(props.dealerGallerySlot),photos=await gallery.type(gallery.props);
  assert.equal(photos.type,f.BuyerGallery);assert.deepEqual(photos.props.images,['https://example.test/buyer.jpg']);
});

test('catalog pricing proceeds while green inventory is blocked, but JSX waits for both complete branches',async()=>{
  const f=await fixture(['green','greenPricing']);let complete=false;
  const pending=page(f).then((tree:any)=>{complete=true;return tree;});await turn();
  assert.ok(f.events.includes('catalogPricing'));assert.equal(f.events.includes('greenPricing'),false);
  assert.equal(f.priceCalls.find(call=>call.phase==='catalogPricing')?.items,f.catalog.items);assert.equal(complete,false);
  f.gates.green.resolve(f.green);await turn();
  assert.ok(f.events.includes('greenPricing'));assert.equal(complete,false);
  f.gates.greenPricing.resolve(f.priced(f.green.items.slice(0,10).map(item=>({...item,publicGreen:true})),'greenPricing'));
  const props=f.client(await pending).props;
  assert.equal(props.initialCity,'Новокузнецк');assert.equal(f.railCalls[0][0],props.initialCity);
  assert.equal(props.initialCount,42);assert.equal(props.initialGreen.items.length,10);
});

test('dealer remains a Suspense branch and starts its rail exactly once when dealer data arrives',async()=>{
  const f=await fixture(['dealer','dealerRail']);
  const props=f.client(await page(f)).props;
  assert.equal(f.railCalls.length,0);
  const specials=child(props.specialRailSlot);let complete=false;
  const pending=specials.type(specials.props).then((result:any)=>{complete=true;return result;});
  f.gates.dealer.resolve(f.dealer);await turn();
  assert.equal(f.railCalls.length,1);assert.equal(complete,false);
  f.gates.dealerRail.resolve(f.rail);
  assert.equal((await pending).type,f.SpecialRail);assert.equal(f.railCalls.length,1);
});

test('snapshot/count failures preserve the original incomplete empty catalog fallback and still price its exact items',async()=>{
  for(const phase of ['snapshot','counts'] as const){
    const f=await fixture([phase]),error=new Error(phase+' unavailable'),pending=page(f);await turn();
    f.gates[phase].reject(error);
    const props=f.client(await pending).props;
    assert.deepEqual(props.initialOffers,[]);assert.deepEqual(props.initialMarketCounts,{});
    assert.deepEqual(props.initialMarketCountInfo,{});assert.equal(props.initialCount,12);assert.equal(props.initialCountIncomplete,true);
    assert.deepEqual(f.priceCalls.find(call=>call.phase==='catalogPricing')?.items,[]);
    assert.deepEqual(f.errors,[['home_initial_catalog_failed',error]]);
    assert.equal(f.countCalls.length,phase==='snapshot'?0:1);
  }
});

test('catalog pricing failure retains the exact audited cards returned by AJES counting',async()=>{
  const f=await fixture(['catalogPricing']),error=new Error('pricing unavailable'),pending=page(f);await turn();
  f.gates.catalogPricing.reject(error);
  const props=f.client(await pending).props;
  assert.equal(props.initialOffers,f.catalog.items);assert.equal(props.initialMarketCounts,f.catalog.marketCounts);
  assert.equal(props.initialCount,42);assert.deepEqual(f.errors,[['home_initial_pricing_failed',error]]);
});

test('green read failure remains incomplete and green pricing failure still rejects the page',async()=>{
  const missing=await fixture(['green']),pending=page(missing);await turn();missing.gates.green.reject(new Error('stock unavailable'));
  const props=missing.client(await pending).props;
  assert.deepEqual(props.initialGreen,{items:[],total:0});assert.equal(props.initialCount,30);assert.equal(props.initialCountIncomplete,true);
  assert.deepEqual(missing.priceCalls.find(call=>call.phase==='greenPricing')?.items,[]);assert.deepEqual(missing.errors,[]);
  const failing=await fixture(['greenPricing','snapshot']),error=new Error('green pricing unavailable');
  const rejected=assert.rejects(page(failing),(caught:unknown)=>caught===error);await turn();
  failing.gates.greenPricing.reject(error);await rejected;
  assert.deepEqual(failing.errors,[],'green pricing must not turn into an empty success or catalog fallback');
  failing.gates.snapshot.resolve(failing.snapshot);await turn();
});

test('early dealer failures keep their existing null fallbacks and catch rail rejection before JSX consumption',async()=>{
  const f=await fixture(['dealer','dealerRail','snapshot']),dealerError=new Error('dealer unavailable'),railError=new Error('rail unavailable');
  const pending=page(f);await turn();f.gates.dealer.reject(dealerError);await turn();
  assert.equal(f.railCalls.length,1);assert.equal(f.railCalls[0][1],null);
  f.gates.dealerRail.reject(railError);await turn();
  assert.deepEqual(f.errors,[['home_dealer_failed',dealerError],['home_specials_failed',railError]]);
  f.gates.snapshot.resolve(f.snapshot);
  const props=f.client(await pending).props,specials=child(props.specialRailSlot),gallery=child(props.dealerGallerySlot);
  assert.equal(await specials.type(specials.props),null);
  assert.deepEqual((await gallery.type(gallery.props)).props.images,[]);assert.equal(f.railCalls.length,1);
});

test('city normalization and precedence remain identical for page props and dealer preparation',async()=>{
  for(const [query,cookie,expected] of [
    [[' <Москва> ', 'ignored'],encodeURIComponent('Казань'),'Москва'],
    ['',encodeURIComponent('  <Новокузнецк>" '),'Новокузнецк'],
    [undefined,'%broken<city>','%brokencity'],
  ] as const){
    const f=await fixture([],cookie),props=f.client(await page(f,query as any)).props;
    assert.equal(props.initialCity,expected);assert.equal(f.railCalls[0][0],expected);
  }
});
