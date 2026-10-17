import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaultShowcase,type SpecialOffer} from '../apps/web/lib/dealers/showcase-model';
test('interactive public offer never receives supplier URL, bank details or other drafts',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'dealer-public-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const outfile=join(dir,'content.cjs');
 await build({entryPoints:['apps/web/components/dealers/DealerOfferContent.tsx'],bundle:true,platform:'node',format:'cjs',jsx:'automatic',outfile,plugins:[{name:'view-boundary',setup(b){b.onResolve({filter:/^\.\/DealerOfferView$/},()=>({path:'view',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export function DealerOfferView(){}'}));}}]});
 const {DealerOfferContent}=createRequire(import.meta.url)(outfile);
 const s=defaultShowcase('dealer_topavto');s.requisites={bankAccount:'private-bank'} as any;s.offers=[{id:'private-draft'} as SpecialOffer];s.offices=[{id:'office',city:'Москва',address:'Публичный адрес',phone:'private-phone',hours:'',lat:null,lon:null,photos:[]}];
 const o={id:'public',make:'Toyota',sourceUrl:'https://supplier.example/private-listing',photos:[]} as unknown as SpecialOffer;
 const view=DealerOfferContent({id:'public',s,o});
 assert.equal(view.props.o.sourceUrl,undefined);assert.equal(view.props.o.make,'Toyota');assert.equal(view.props.s.requisites,undefined);assert.equal(view.props.s.offers,undefined);assert.equal(view.props.s.offices[0].phone,'');assert.equal(view.props.s.offices[0].address,'Публичный адрес');assert.deepEqual(view.props.s.pricing,s.pricing);
});
