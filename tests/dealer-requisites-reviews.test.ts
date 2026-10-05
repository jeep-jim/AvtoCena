import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultShowcase,normalizeShowcase} from '../apps/web/lib/dealers/showcase-model';
import {EMPTY_REQUISITES,normalizeRequisites} from '../apps/web/lib/dealers/requisites';
import {publicDealerProfile} from '../apps/web/lib/dealers/public-profile';
import {canReviewDealer,normalizeReviewInput,dealerReviewSummary,type DealerReview} from '../apps/web/lib/dealers/review-policy';
test('company requisites stay isolated and banking details never cross public boundary',()=>{
 const other=defaultShowcase('another','Другая компания');assert.deepEqual(other.requisites,EMPTY_REQUISITES);
 other.requisites=normalizeRequisites({legalName:'ООО Пример',inn:'7707083893',ogrn:'1027700132195',kpp:'420502002',bank:'Банк',bik:'043207612',account:'40802810926710009905',correspondentAccount:'30101810200000000612'});
 const saved=normalizeShowcase(other,other.dealerId,1);assert.equal(saved.requisites?.account,other.requisites.account);
 const dto=publicDealerProfile(saved);assert.equal(dto.requisites?.legalName,'ООО Пример');
 for(const key of ['bank','bik','account','correspondentAccount'])assert.equal(key in dto.requisites!,false);
 assert.ok(!JSON.stringify(dto).includes('40802810926710009905'));
 assert.equal(defaultShowcase('dealer_topavto').requisites?.inn,'422036933030');
 assert.throws(()=>normalizeRequisites({inn:'123'}),/ИНН/);assert.throws(()=>normalizeRequisites({account:123}),/текстом/);
});
test('review requires verified client, matching platform application and separate confirmed contract',()=>{
 const link={userId:'user',clientId:'client',verifiedAt:'2026-10-02T10:00:00Z'};
 const lead={id:'lead',clientId:'client',dealerId:'dealer',source:'avtocena' as const};
 const confirmation={contractId:'contract',leadId:'lead',clientId:'client',dealerId:'dealer',confirmedBy:'manager',confirmedAt:'2026-10-02T11:00:00Z'};
 const allowed=(l=link,p=lead,c:typeof confirmation|null=confirmation,reviews:DealerReview[]=[])=>canReviewDealer('user','dealer',l,p,c,reviews);
 assert.equal(allowed(),true);assert.equal(allowed(link,lead,null),false);
 assert.equal(allowed({...link,userId:'stranger'}),false);assert.equal(allowed({...link,verifiedAt:''}),false);
 assert.equal(allowed(link,{...lead,dealerId:'other'}),false);assert.equal(allowed(link,lead,{...confirmation,leadId:'other'}),false);
 assert.equal(allowed(link,lead,{...confirmation,clientId:'other'}),false);assert.equal(allowed(link,lead,{...confirmation,confirmedBy:''}),false);
 assert.equal(canReviewDealer('user','dealer',link,lead,{...confirmation,revokedAt:'2026-10-02T12:00:00Z'},[]),false);
 const review:DealerReview={id:'review',userId:'user',dealerId:'dealer',leadId:'lead',contractId:'contract',rating:5,text:'Спасибо за автомобиль',createdAt:'2026-10-02T12:00:00Z',status:'hidden'};
 assert.equal(allowed(link,lead,confirmation,[review]),false);
 assert.deepEqual(dealerReviewSummary([review],'dealer'),{count:0,rating:null});
 assert.deepEqual(dealerReviewSummary([{...review,status:'published'},{...review,id:'second',status:'published',rating:4}],'dealer'),{count:2,rating:4.5});
 assert.throws(()=>normalizeReviewInput(6,'Длинный текст отзыва'),/оценку/);assert.throws(()=>normalizeReviewInput(4,'Мало'),/символов/);
});
test('review slider accepts tenths and preserves decimal ratings in public totals',()=>{
 assert.deepEqual(normalizeReviewInput(4.2,'  Спасибо за помощь!  '),{rating:4.2,text:'Спасибо за помощь!'});
 for(const rating of [NaN,Infinity,0,5.1,4.25,'4.2'])assert.throws(()=>normalizeReviewInput(rating,'Спасибо за помощь!'));
 assert.deepEqual(dealerReviewSummary([{dealerId:'d',status:'published',rating:4.2},{dealerId:'d',status:'published',rating:5},{dealerId:'d',status:'hidden',rating:1}] as DealerReview[],'d'),{count:2,rating:4.6});
});
