import test from 'node:test';
import assert from 'node:assert/strict';
import {parseJapanSourcePower,japanPowerSearchHint,japanPowerSearchLabel} from '../apps/web/lib/catalog/japan-source-power';
import {ajesResultFilter} from '../apps/web/lib/catalog/ajes-result-filter';
import {ajesPowerEstimateHp} from '../apps/web/lib/catalog/ajes-power-estimate';
import {ajesLot} from '../apps/web/lib/catalog/ajes-query';
import {ajesOffer} from '../apps/web/lib/catalog/ajes-offer';
import {publicOffer} from '../apps/web/lib/catalog/storage';
import {readFilteredAjesPage} from '../apps/web/lib/catalog/ajes-filtered-page';

function offer(power:unknown,id='power-fixture'){
 const row={ID:id,MARKA_NAME:'TOYOTA',MODEL_NAME:'TEST',YEAR:2023,AUCTION_TYPE:2,STATUS:'Sold',FINISH:935000,TIME:'P',PW:power,ENG_V:1490,IMAGES:''};
 const rate={currency:'JPY',sourcePrice:935000,effectiveRate:0.6,cbrRate:60,nominal:100,rateDate:'2026-11-12',rateSource:'cbr'} as any;
 return ajesOffer(ajesLot(row,'stats',false)!,rate,'2026-11-12T13:00:00Z');
}

test('source power accepts complete numeric alternatives and rejects malformed/unknown values',()=>{
 assert.deepEqual(parseJapanSourcePower(' 79, 98,79 '),[79,98]);
 assert.deepEqual(parseJapanSourcePower(160),[160]);
 assert.deepEqual(parseJapanSourcePower('159.5'),[159.5]);
 for(const value of ['',0,-1,'0,98','150,bad','150,2501','150-180','160 hp','1e2','150;drop',null,{},Array(21).fill('150').join(',')])assert.deepEqual(parseJapanSourcePower(value),[]);
});

test('Japan range accepts all alternatives inclusively; local facts win over source hints',()=>{
 const filter=ajesResultFilter({market:'japan',powerFrom:80,powerTo:160});
 for(const [raw,expected] of [['80',true],['160',true],['100,150',true],['79,150',false],['150,180',false],['',false]] as const)assert.equal(filter.matches(offer(raw)),expected,raw);
 assert.equal(filter.matches({...offer('200'),powerHp:150}),true);
 assert.equal(filter.matches({...offer('150'),powerHp:180}),false);
 assert.equal(filter.matches({...offer(''),savedCalculationPreview:{parameters:{powerHp:150},totalRub:1000000}}),false);
 for(const market of ['korea','china','uae'])assert.equal(ajesResultFilter({market,powerTo:160}).matches({...offer('150'),market}),false);
 assert.equal(filter.matches({...offer('150'),id:'other-source'}),false);
 assert.equal(filter.matches({...offer('150'),sourceId:'other-source'}),false);
 for(const extra of [{fuel:'hybrid'},{fuel:'electric'},{powertrainKind:'series_hybrid'},{model:'TEST HYBRID'},{operational:{raw:{sourcePower:'150',sourceFuel:'H'}}}])assert.equal(filter.matches({...offer('150'),...extra}),false);
});

test('public card preserves labelled discovery hint without publishing private data or calculation power',()=>{
 const input=offer('100,150'),before=JSON.stringify(input);
 const output=publicOffer(input) as any;
 assert.deepEqual(output.japanPowerSearchHint,{offerId:input.id,values:[100,150],requiresConfirmation:true});
 assert.equal(japanPowerSearchLabel(output),'100 / 150 л.с. · предварительно');
 assert.equal(output.powerHp,undefined);
 assert.equal(output.power30MinKw,undefined);
 assert.equal(output.totalRub,null);
 assert.equal(output.catalogPricingMode,'seller');
 assert.equal(output.operational,undefined);
 assert.equal(output.sourceId,undefined);
 assert.equal(ajesPowerEstimateHp(input),undefined);
 assert.equal(ajesPowerEstimateHp(output),undefined);
 assert.equal(JSON.stringify(input),before);
 assert.equal(ajesResultFilter({market:'japan',powerTo:160}).matches(output),true);
 assert.equal(japanPowerSearchHint({...output,id:'ajes-stats-another'}),undefined);
 assert.equal(japanPowerSearchHint({...output,powerHp:180}),undefined);
});

test('partial filtered page continuation preserves order and cannot treat discovery as exact inventory',async()=>{
 const all=['100','180','150','79,98','200','160'].map((pw,i)=>offer(pw,'row'+i));
 const filter=ajesResultFilter({market:'japan',powerTo:160});
 const read=async(page:number)=>{const rows=all.slice((page-1)*3,page*3);return {received:rows.length,items:rows.filter(filter.matches)};};
 const first=await readFilteredAjesPage({page:1,pageSize:2,sourcePageSize:3,read});
 const second=await readFilteredAjesPage({page:1,pageSize:2,sourcePageSize:3,after:first.nextCursor,read});
 assert.deepEqual([...first.items,...second.items].map(v=>v.id),['ajes-stats-row0','ajes-stats-row2','ajes-stats-row3','ajes-stats-row5']);
 const partial=await readFilteredAjesPage({page:1,pageSize:6,sourcePageSize:3,read:async()=>({received:3,items:[all[0]],partial:true,stale:true})});
 assert.equal(partial.partial,true);assert.equal(partial.stale,true);
});
