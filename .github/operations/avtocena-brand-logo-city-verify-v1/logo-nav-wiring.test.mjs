import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
const load=createRequire(resolve('apps/web/package.json')),ts=load('typescript');
const get=(path)=>readFileSync(resolve(path),'utf8');
const btn=get('apps/web/components/catalog/BrandLogoRail.tsx');
const loader=get('apps/web/components/layout/RoutePreloader.tsx');
const left=get('apps/web/components/catalog/CatalogFilters.tsx');
const wrapper=(path,content)=>ts.createSourceFile(path,content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const decl=(ast,id)=>{let result;function search(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===id)result=n;ts.forEachChild(n,search);}search(ast);return result;};
const ast=wrapper('BrandLogoRail.tsx',btn);
const cut=(name)=>{const n=decl(ast,name);assert.ok(n,name);return n.initializer.getText(ast);};
const js=(x)=>ts.transpileModule(x,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
test('public rail tiles opt out before the unchanged document capture loader sees click; two tile styles use no Next prefetch',()=>{
 const statement=decl(wrapper('RoutePreloader.tsx',loader),'handleClick').initializer.getText();
 assert.match(loader,/document.addEventListener\("click",handleClick,true\)/);
 const tiles=btn.match(/prefetch=\{false\}\s+data-no-route-loader=\{localFilter \? "true" : undefined\}/g);
 assert.equal(tiles?.length,2);
 const simulate=no=>{
  let visible=0;
  class Element{closest(s){return s==='a[href]'?{href:'https://example.test/cars/china/Toyota',dataset:{noRouteLoader:no},target:'',hasAttribute:()=>false}:null;}}
  const click=runInNewContext(js('('+statement+');'),{Element,URL,window:{location:{href:'https://example.test/cars/china',origin:'https://example.test',pathname:'/cars/china',search:''}},
   sameDocumentHashNavigation:()=>false,show:()=>{visible++}});
  click({button:0,defaultPrevented:false,target:new Element()});return visible;
 };
 assert.equal(simulate(undefined),1);assert.equal(simulate('true'),0);
});
test('normal click uses transition push and selected city once; modified links remain native, dealer branch unchanged',()=>{
 const leftPush=left.match(/startTransition\(\(\)=>router.push\(href, \{ scroll: false \}\)\)/g);
 assert.equal(leftPush?.length,1);
 assert.match(btn,/localFilter \? brandFilterHref\(searchParamsText,nextForBrand\(brand\),null,selectedCity\)/);
 assert.match(btn,/const localFilter = !homeBrandDirectory && !dealer/);
 const runs=[];
 const target='/cars/china/Toyota?city=%D0%A3%D1%81%D1%81%D1%83%D1%80%D0%B8%D0%B9%D1%81%D0%BA';
 const set=runInNewContext(js('('+cut('setCatalogBrands')+');'),{
  localFilter:true,searchParamsText:'market=china',pathname:'/cars/china',searchParams:new URLSearchParams(),lastFilterNavigation:{current:null},readSelectedCity:()=> 'Уссурийск',
  brandFilterHref:(q,b,d,city)=>{runs.push([q,b.join(','),d,city]);return target;},
  rememberFilterScroll:href=>runs.push(['scroll',href]),
  startTransition:fn=>{runs.push(['transition']);fn();},router:{push:href=>runs.push(['push',href]),replace:()=>assert.fail('public logo replaced history')},
 });
 const action=runInNewContext(js('('+cut('handleBrandClick')+');'),{
  localFilter:true,homeBrandDirectory:false,close:()=>assert.fail('unexpected close'),setCatalogBrands:set,nextForBrand:brand=>[brand],
 })('Toyota');
 const makeEvent=(extra={})=>({button:0,defaultPrevented:false,preventDefault:()=>runs.push(['no default']),...extra});
 action(makeEvent({ctrlKey:true}));action(makeEvent({button:1}));action(makeEvent({defaultPrevented:true}));
 assert.deepEqual(runs,[]);
 action(makeEvent());
 assert.deepEqual(runs,[['no default'],['market=china','Toyota',null,'Уссурийск'],['scroll',target],['transition'],['push',target]]);
 action(makeEvent());
 assert.equal(runs.filter(entry=>entry[0]==='push').length,1);

 assert.match(btn,/router.replace\(dealerBrowsingHref\(queryString/);
 assert.match(btn,/\x60\/cars\/brand\/\$\{catalogBrandSlug\(brand\)\}\x60/);
});
