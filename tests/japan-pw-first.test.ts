import test from 'node:test';
import assert from 'node:assert/strict';
import {firstJapanSourcePower,japanPowerSearchHint,japanPowerSearchLabel,japanPowerUnknown} from '../apps/web/lib/catalog/japan-source-power';
import {ajesResultFilter} from '../apps/web/lib/catalog/ajes-result-filter';
import {ajesLot} from '../apps/web/lib/catalog/ajes-query';
import {ajesOffer} from '../apps/web/lib/catalog/ajes-offer';
import {publicOffer} from '../apps/web/lib/catalog/storage';
import {ajesPowerEstimateHp} from '../apps/web/lib/catalog/ajes-power-estimate';
import {japanPreviewParameters} from '../apps/web/lib/catalog/japan-preview-parameters';

const offer=(value:unknown,patch:Record<string,unknown>={})=>({id:'ajes-stats-fixture',market:'japan',sourceId:'ajes_japan_feed',
 make:'TOYOTA',model:'FIXTURE',year:2023,fuel:'petrol',engineCc:1500,operational:{raw:{sourcePower:value}},...patch});

test('Japan PW uses only its first numeric value and never searches later values for a match',()=>{
 for(const [source,expected] of [['52,64',52],['170,98',170],[' 109 ',109],[98,98],['52 / 64',52],['PW: 91',91],['150.5,160',150.5],
  ['2501,52',2501],[2501,2501],[Number.MAX_VALUE,Number.MAX_VALUE],['3e3,52',3000],['52,'+'64,'.repeat(100),52]] as const)
  assert.equal(firstJapanSourcePower(source),expected,String(source));
 for(const source of [undefined,null,'','  ','нет','-52,64','0,64',Infinity,{},[52,64],'1e309','1'.repeat(400)])
  assert.equal(firstJapanSourcePower(source),undefined,String(source));
 assert.equal(japanPowerSearchHint(offer('52,64'))?.horsepower,52);
 assert.equal(japanPowerSearchHint(offer('170,98'))?.horsepower,170);
});

test('the <=160 search keeps unknown Japan cars and marks preliminary power without weakening known values',()=>{
 const filter=ajesResultFilter({market:'japan',powerTo:'160'});
 for(const row of [offer('52,64'),offer('109'),offer(''),offer(undefined),offer('не указано'),offer('52,170',{fuel:'hybrid'}),offer('',{fuel:'electric'})])
  assert.equal(filter.matches(row),true,JSON.stringify(row));
 for(const row of [offer('170,52'),offer('250'),offer('2501,52'),offer('52',{powerHp:180})])assert.equal(filter.matches(row),false);
 assert.equal(filter.matches(offer('250',{powerHp:150})),true,'the existing known value wins');
 assert.equal(filter.matches(offer('250',{make:'HONDA',model:'STEPWGN'})),true,'the explicit owner override remains unchanged');
 assert.equal(ajesResultFilter({market:'japan',powerFrom:'100',powerTo:'160'}).matches(offer('52,150')),false);
 assert.equal(ajesResultFilter({market:'japan',powerFrom:'100',powerTo:'160'}).matches(offer('')),true);
 assert.equal(ajesResultFilter({market:'china',powerTo:'160'}).matches(offer('',{market:'china'})),false);
 assert.equal(filter.matches({id:'unrelated',market:'japan'}),false,'only AJ Japan rows receive this missing-value policy');
 assert.equal(japanPowerUnknown(offer('')),true);
 assert.equal(japanPowerUnknown(offer('52,64')),false);
 assert.equal(japanPowerUnknown(offer('',{powerHp:150})),false);
});

test('real AJ mapping and public DTO retain first PW with explicit origin without promoting calculation power',()=>{
 const at='2026-11-25T10:00:00.000Z';
 const lot=ajesLot({ID:'fixture',MARKA_NAME:'TOYOTA',MODEL_NAME:'FIXTURE',YEAR:'2023',AUCTION_TYPE:'2',STATUS:'Sold',FINISH:'935000',PW:'52,64',ENG_V:'1500',TIME:'P'},'stats')!;
 const rate:any={currency:'JPY',sourcePrice:935000,rateSource:'cbr',effectiveRate:0.6,rate:0.6,baseRate:0.6,observedAt:at};
 const raw=ajesOffer(lot,rate,at),before=structuredClone(raw),dto:any=publicOffer(raw);
 assert.equal(raw.powerHp,undefined);assert.equal(dto.powerHp,undefined);
 assert.equal(dto.powerKw,undefined);assert.equal(dto.power30MinKw,undefined);
 assert.deepEqual(dto.japanPowerSearchHint,{offerId:raw.id,horsepower:52,source:'ajes_pw_first',requiresConfirmation:true});
 assert.equal(dto.japanPowerUnknown,undefined);
 assert.equal(dto.operational,undefined);assert.equal(dto.sourceId,undefined);
 assert.doesNotMatch(JSON.stringify(dto),/sourcePower|52,64/,'private source text is not published');
 assert.match(japanPowerSearchLabel(dto),/52 л\.с\. · предварительно/);
 assert.equal(ajesPowerEstimateHp(raw),undefined);
 assert.throws(()=>japanPreviewParameters(raw),/powerHp/,'supplier PW must not silently complete a customs calculation');
 assert.deepEqual(raw,before,'projection and discovery must not rewrite the saved offer');
 const unknown=ajesOffer({...lot,sourcePower:''},rate,at),unknownDto:any=publicOffer(unknown);
 assert.equal(unknownDto.id,raw.id);assert.equal(unknownDto.japanPowerUnknown,true);
 assert.equal(unknownDto.japanPowerSearchHint,undefined);assert.equal(unknownDto.powerHp,undefined);
 assert.equal(ajesResultFilter({market:'japan',powerTo:'160'}).matches(unknown),true);
});

test('a public preliminary hint is bound to the exact Japanese offer and source policy',()=>{
 const source=offer('52,64'),hint=japanPowerSearchHint(source)!;
 const dto={id:source.id,market:'japan',japanPowerSearchHint:hint};
 assert.deepEqual(japanPowerSearchHint(dto),hint);
 for(const changed of [{...hint,offerId:'ajes-stats-other'},{...hint,source:'factory'},{...hint,requiresConfirmation:false},
  {...hint,horsepower:0},{...hint,horsepower:NaN},{...hint,horsepower:Infinity}])
  assert.equal(japanPowerSearchHint({...dto,japanPowerSearchHint:changed}),undefined);
 for(const changed of [{...dto,market:'china'},{...dto,id:'foreign-fixture'},{...dto,powerHp:180}])assert.equal(japanPowerSearchHint(changed),undefined);
 assert.equal(japanPowerSearchHint({...source,sourceId:'other_source'}),undefined);
 assert.equal(japanPowerSearchHint({...dto,japanPowerSearchHint:{...hint,horsepower:2501}})?.horsepower,2501);
});
