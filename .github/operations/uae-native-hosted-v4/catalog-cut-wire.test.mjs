import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
const load=createRequire(resolve('apps/web/package.json'));
const ts=load('typescript');
const path='apps/web/components/catalog/CatalogContent.tsx';
const source=readFileSync(path,'utf8');
const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const matches=[];
function visit(node){
 if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(ast)==='CatalogLoadMore')matches.push(node);
 ts.forEachChild(node,visit);
}
visit(ast);
const one=matches.filter(node=>node.attributes.properties.some(p=>p.name?.getText(ast)==='initialCards'));
assert.equal(one.length,1);
const expr=(name)=>one[0].attributes.properties.find(p=>p.name?.getText(ast)===name).initializer.expression.getText(ast);
const query=expr('query'),key=expr('key');
assert.match(source,/const chinaCut=selectedMarket==='china'/);
assert.match(source,/const uaeCut=uaeEnabled&&selectedMarket==='uae'/);
assert.match(query,/chinaCut\?\{preparedCut:chinaCut.generationId\}:uaeCut\?\{preparedCut:uaeCut.generationId\}/);
const evalWire=(marketId,china,uae)=>{
 const context={common:{make:'Kia',sort:'updatedAt'},market:{id:marketId},
  chinaCut:china?{generationId:china}:null,uaeCut:uae?{generationId:uae}:null,
  params:{},requestedPage:2,pageHref:(_params,page)=>`/cars/${marketId}?page=${page}`};
 return JSON.parse(runInNewContext(`JSON.stringify({query:(${query}),key:(${key})})`,context,{timeout:100}));
};
test('existing China grid sends its exact active cut with the normal query and reset key',()=>{
 assert.deepEqual(evalWire('china','china-active',null),
 {query:{make:'Kia',sort:'updatedAt',market:'china',preparedCut:'china-active'},key:'/cars/china?page=2:china-active'});
 assert.notEqual(evalWire('china','china-active',null).key,evalWire('china','china-next',null).key);
});
test('UAE has a separate generation and legacy neighbors are not pinned to another market',()=>{
 assert.deepEqual(evalWire('uae',null,'uae-active'),
 {query:{make:'Kia',sort:'updatedAt',market:'uae',preparedCut:'uae-active'},key:'/cars/uae?page=2:uae-active'});
 assert.notEqual(evalWire('uae',null,'uae-active').key,evalWire('uae',null,'uae-next').key);
 assert.deepEqual(evalWire('georgia',null,null),
 {query:{make:'Kia',sort:'updatedAt',market:'georgia'},key:'/cars/georgia?page=2'});
 assert.deepEqual(evalWire('uae',null,null).query,{make:'Kia',sort:'updatedAt',market:'uae'});
});
