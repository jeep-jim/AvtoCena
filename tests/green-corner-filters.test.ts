import test from 'node:test';
import assert from 'node:assert/strict';
import { filterGreenCorner } from '../apps/web/lib/catalog/green-corner-search';
const rows:any[]=[{id:'1',make:'HONDA',model:'FREED',year:2020,engineCc:1500,powerHp:118,mileageKm:45000,sellerPriceRub:600000,drive:'fwd',transmission:'IAT',auctionGrade:'4'},{id:'2',make:'TOYOTA',model:'PRIUS',year:2021,engineCc:1800,powerHp:180,mileageKm:80000,sellerPriceRub:900000,auctionGrade:'4.5'},{id:'3',make:'HONDA',model:'FIT',year:2019}];
test('Green filters combine source fields and reject missing bounded values',()=>{
 assert.deepEqual(filterGreenCorner(rows,{make:'HONDA',engineTo:'1.6',powerTo:'160',mileageTo:'50000',drive:'fwd',transmission:'IAT',auctionGrade:'4'}).map(x=>x.id),['1']);
 assert.deepEqual(filterGreenCorner(rows,{fobTo:'700000'}).map(x=>x.id),['1']);
 assert.deepEqual(filterGreenCorner(rows,{budget:'1000000'}),[]);
 assert.deepEqual(filterGreenCorner(rows,{make:'HONDA,TOYOTA',yearFrom:'2020',sort:'yearAsc'}).map(x=>x.id),['1','2']);
 assert.deepEqual(filterGreenCorner(rows,{fuel:'electric'}),[]);
});
