import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
const load=createRequire(resolve('apps/web/package.json'));
const ts=load('typescript'),React=load('react'),{renderToStaticMarkup}=load('react-dom/server');
const root=process.env.UAE_PRICE_SEMANTICS_SOURCE_ROOT??process.cwd();
function read(path,sha){
 const buf=readFileSync(resolve(root,path));
 const got=createHash('sha1').update('blob '+buf.length+'\0').update(buf).digest('hex');
 assert.equal(got,sha,path+' exact app bytes');
 return buf.toString('utf8');
}
const trend=read('apps/web/components/catalog/PriceTrend.tsx','af336b005e89e9771f705366dbdbafb30838e5de');
const inline=read('apps/web/components/catalog/InlineOfferParameters.tsx','16ab0f4b2cd1a79c67e9352c18d5a1752a904f18');
const page=read('apps/web/app/(public)/cars/offer/[id]/page.tsx','868a24308690737b3da4720639cd2f1fbb9fc50f');
test('prepared ordinary no-price UAE uses the standard price panel, not the retro heading',()=>{
 assert.match(page,/!isPriceOnRequestDubicarsOffer\(raw\)/);
 assert.match(page,/<main data-autobot-electrified=.*?data-offer-id=\{o\.id\}.*?data-offer-price-rub=/s);
 assert.match(page,/<PriceTrend hideAuctionGrade offer=\{o\}.*?className="ac-offer-price-panel"/s);
 assert.match(inline,/!showCalculation \|\| keepSellerPrice \? price :/);
 assert.match(page,/autoCalculate=\{!\('preparedUae' in detail\) &&/);
 assert.match(page,/\{retro \? <section[^>]*data-retro-offer>[\s\S]*?<h2[^>]*>Цена по запросу<\/h2>/u);
});
test('exact actual PriceTrend JSX renders visible text inside div.ac-price, not a heading or amount',()=>{
 const ast=ts.createSourceFile('PriceTrend.tsx',trend,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const component=ast.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='PriceTrend');
 const variants=[];
 function visit(n){
  if(ts.isJsxElement(n)&&n.openingElement.tagName.getText(ast)==='div'&&
   n.openingElement.attributes.properties.some(p=>p.name?.getText(ast)==='className'&&p.initializer?.getText(ast).includes('ac-price ${priceStateClass}')))
    variants.push(n);
  ts.forEachChild(n,visit);
 }
 visit(component.body);assert.equal(variants.length,1);
 const hasPrice=component.body.statements.find(s=>ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>d.name.getText(ast)==='hasPrice'));
 const js=ts.transpileModule(hasPrice.getText(ast)+'\n('+variants[0].getText(ast)+');',{
  compilerOptions:{target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React}
 }).outputText;
 const render=(totalRub)=>renderToStaticMarkup(runInNewContext(js,{React,pricedOffer:{totalRub},canShowRate:false,
  openSheet(){},priceStateClass:'ac-price--flat',greenCorner:false,highlightElectrified:false,priceClassName:'',
  priceColor:undefined,money:n=>String(n),currency:'AED'},{timeout:100}));
 const unpriced=render(null);
 assert.match(unpriced,/<div class="ac-price [^"]+"[^>]*>Цена по запросу<\/div>$/u);
 assert.doesNotMatch(unpriced,/<h[1-6]\b|₽|AED/u);
 assert.match(render(1101078),/1101078[\s\S]*₽/u);
 assert.doesNotMatch(render(1101078),/Цена по запросу/u);
});
