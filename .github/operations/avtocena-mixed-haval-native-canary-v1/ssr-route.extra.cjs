// tsx reads the production JSX-preserve tsconfig; the raw module fixture needs React in scope.
globalThis.React=react;
const exactLeaf=(name)=>String(name);
const leafModules={
 './CatalogBreadcrumbs':{CatalogBreadcrumbs:exactLeaf('fixture-breadcrumbs')},
 './CatalogCountLabel':{CatalogCountLabel:exactLeaf('fixture-total')},
 './MarketResultCount':{MarketResultCount:exactLeaf('fixture-market-count')},
 './CatalogSidebar':{CatalogSidebar:exactLeaf('fixture-sidebar')},
 './GreenCornerCatalog':{GreenCornerCatalog:exactLeaf('fixture-green-catalog')},
 './AjesCatalog':{AjesCatalog:exactLeaf('fixture-ajes-catalog')},
 './AjesRail':{AjesRail:exactLeaf('fixture-ajes-rail'),readAjesRailData:()=>assert.fail('no live supplier in this mixed route'),CatalogEmptyResults:exactLeaf('fixture-empty')},
 './CatalogLoading':{CatalogSectionLoading:exactLeaf('fixture-loading')},
 '@/components/catalog/JapanSectionTabs':{JapanSectionTabs:exactLeaf('fixture-japan-tabs')},
 '@/components/catalog/GreenCornerRail':{GreenCornerRail:exactLeaf('fixture-green-rail')},
 '@/components/dealers/DealerBrowsingContext':{DealerLink:exactLeaf('fixture-link')},
 '@/components/layout/PublicHeader':{PublicHeader:exactLeaf('fixture-header')},
 '@/components/catalog/BrandLogoRail':{BrandLogoRail:exactLeaf('fixture-brand-rail')},
 '@/components/catalog/CatalogLoadMore':{CatalogLoadMore:exactLeaf('fixture-load-more')},
 '@/components/catalog/CatalogCard':{CatalogCard:exactLeaf('fixture-card')},
 '@/components/catalog/CatalogMarketFlag':{CatalogMarketFlag:exactLeaf('fixture-flag')},
 '@/components/catalog/CatalogFilters':{CatalogFilters:exactLeaf('fixture-filters')},
 '@/components/catalog/CurrencyRatesStrip':{CurrencyRatesStrip:exactLeaf('fixture-rates')},
 '@/lib/catalog/china-public-aggregate':{omitLegacyChinaAggregate:()=>true,withChinaAggregateAuthority:async(_market,f)=>f()},
 '@/lib/catalog/live-business-pricing':{applyActiveBusinessPricingBatch:async(a)=>a},
};
const pathSuffix='/components/catalog/CatalogContent.tsx';
Module._load=function(id,parent,...rest){
 if(id==='server-only')return {};
 if(parent?.filename.endsWith(pathSuffix)&&Object.hasOwn(leafModules,id))return leafModules[id];
 return priorLoad.call(this,id,parent,...rest);
};
const {CatalogContent}=require('../apps/web/components/catalog/CatalogContent.tsx');
Module._load=priorLoad;
function inspectNodes(node,match,found=[]){
 if(Array.isArray(node))for(const arg of node)inspectNodes(arg,match,found);
 else if(node&&typeof node==='object'&&node.props){
  if(match(node))found.push(node);
  for(const v of Object.values(node.props))inspectNodes(v,match,found);
 }
 return found;
}
test('actual mixed CatalogContent returns own Haval UAE HTML props before delayed China and signals only pending aggregate',async()=>{
 await fixture(async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  setup(gate);
  try{
   const screen=await CatalogContent({params:{market:'china|uae',make:'Haval',model:'Jolion',yearFrom:'2022',yearTo:'2024',preparedCut:generationId}});
   const byType=(screen,type)=>inspectNodes(screen,node=>node.type===type||node.type?.name===type);
   assert.deepEqual(byType(screen,'fixture-card').map(r=>r.props.offer.id),['uae-one']);
   const china=byType(screen,'ResolvedMixedChinaRail');assert.equal(china.length,1);
   const count=byType(screen,'ResolvedCatalogCount');assert.equal(count.length,1);
   assert.equal(byType(screen,'fixture-total')[0].props.countIncomplete,true);
   const pending=Symbol(),probe=Promise.resolve(pending);
   assert.equal(await Promise.race([china[0].props.read,probe]),pending);
   release();
   const own=await china[0].type(china[0].props);
   const actual=byType(own,'fixture-card').map(r=>r.props.offer.id);
   assert.equal(actual.length,3);assert.deepEqual(actual.sort(),['china-one','china-over','china-two']);
   assert.equal(byType(own,'fixture-market-count')[0].props.total,3);
   const final=await count[0].type(count[0].props);
   assert.equal(final.props.total,4);assert.equal(final.props.countIncomplete,false);
  }finally{release();}
 });
});
test('actual mixed CatalogContent with moved cut shows China unavailable, UAE count remains and no false empty',async()=>{
 await fixture(async()=>{
  setup(Promise.resolve());
  const output=await CatalogContent({params:{market:'china|uae',make:'Haval',preparedCut:'gen_1795239842030_other'}});
  const of=(tree,type)=>inspectNodes(tree,node=>node.type===type||node.type?.name===type);
  assert.deepEqual(of(output,'fixture-card').map(r=>r.props.offer.id),['uae-one']);
  const china=of(output,'ResolvedMixedChinaRail')[0],count=of(output,'ResolvedCatalogCount')[0],empty=of(output,'ResolvedCatalogEmpty')[0];
  assert.ok(china&&count&&empty);
  const chinaResult=await china.type(china.props);
  assert.equal(of(chinaResult,'fixture-card').length,0);
  assert.equal(of(chinaResult,'fixture-market-count')[0].props.total,undefined);
  assert.match(JSON.stringify(chinaResult),/Не удалось загрузить автомобили этого направления/);
  const final=await count.type(count.props);
  assert.equal(final.props.total,1);assert.equal(final.props.countIncomplete,true);
  assert.equal(await empty.type(empty.props),null);
  assert.equal(reads,0);
 });
});
