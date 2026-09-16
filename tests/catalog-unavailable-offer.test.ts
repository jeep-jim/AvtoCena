import test from 'node:test';
import assert from 'node:assert/strict';
import { unavailableOfferRecord, mergeUnavailableOffers } from '../apps/web/lib/catalog/offer-availability';
const now = new Date('2026-09-16T03:00:00Z');
const offer:any = {id:'a',market:'korea',sourceId:'encar_direct',sourceOfferId:'123',make:'Hyundai',model:'Avante',updatedAt:'2026-09-15T03:00:00Z',operational:{sourceUrl:'https://fem.encar.com/cars/detail/123'}};
const evidence:any = {id:'a',market:'korea',sourceId:'encar_direct',sourceOfferId:'123',status:'sold',observedAt:now.toISOString()};

test('only newer identity-matched source evidence can say sold/removed',()=>{
  assert.equal(unavailableOfferRecord(offer,undefined,now).reason,'unavailable');
  assert.equal(unavailableOfferRecord(offer,new Map([['a',evidence]]),now).reason,'sold');
  assert.equal(unavailableOfferRecord(offer,new Map([['a',{...evidence,status:'removed'}]]),now).reason,'removed');
  for(const patch of [{sourceOfferId:'another'},{sourceId:'another'},{market:'china'},{observedAt:'2026-09-14'},{status:'http_403'}]) {
    assert.equal(unavailableOfferRecord(offer,new Map([['a',{...evidence,...patch}]]),now).reason,'unavailable');
  }
  assert.equal(unavailableOfferRecord(offer,undefined,now).sourceUrl,offer.operational.sourceUrl);
  for(const url of ['javascript:alert(1)','https://phishing.example/123']) assert.equal(unavailableOfferRecord({...offer,operational:{sourceUrl:url}},undefined,now).sourceUrl,undefined);
});
test('availability metadata expires in 14 days, active returns win, Japan is excluded',()=>{
  const row=unavailableOfferRecord(offer,undefined,now);
  assert.deepEqual(mergeUnavailableOffers([row],[],new Set(),now.getTime()+13*86400000),[row]);
  assert.deepEqual(mergeUnavailableOffers([row],[],new Set(),now.getTime()+15*86400000),[]);
  assert.deepEqual(mergeUnavailableOffers([row],[],new Set(['a']),now.getTime()),[]);
  assert.deepEqual(mergeUnavailableOffers([{...row,market:'japan'}],[],new Set(),now.getTime()),[]);
  assert.equal(mergeUnavailableOffers([row],[],new Set(),now.getTime()+86400000)[0].removedAt,row.removedAt);
});
