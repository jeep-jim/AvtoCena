import test from 'node:test';
import assert from 'node:assert/strict';
import {newerKoreaDetail,preserveKoreaListingLink} from '../apps/web/lib/catalog/ajes-korea-detail-cache';
test('preview reuses newer opened full detail of same paid listing, never an unrelated or stale snapshot',()=>{
 const now=Date.now(),at=new Date(now-1000).toISOString(),old=new Date(now-5000).toISOString();
 const lot:any={table:'korea',id:'paid-audi',engineCc:1984,sourcePower:''};
 const detail={...lot,engineCc:1968,sourcePower:'190'};
 const saved={fullInformation:true,observedAt:at,items:[detail]};
 assert.equal(newerKoreaDetail(lot,old,saved,now),detail);
 for(const change of [{fullInformation:false},{stale:true},{partial:true},{items:[{...detail,id:'another'}]},{items:[{...detail,table:'china'}]},{observedAt:new Date(now-3600000).toISOString()},{observedAt:new Date(now+1000).toISOString()}])assert.equal(newerKoreaDetail(lot,old,{...saved,...change},now),lot);
 assert.equal(newerKoreaDetail(lot,new Date(now).toISOString(),saved,now),lot);
});

test('richer Korea detail cannot erase an evidenced source link of the same ID and LOT',()=>{
 const url='https://www.encar.com/dc/dc_cardetailview.do?carid=43015007';
 const listed:any={table:'korea',id:'same',lot:'43015007',status:url,sourcePrice:10};
 const detail:any={...listed,status:'',sourcePrice:20,engineCc:1968};
 const merged=preserveKoreaListingLink(detail,listed);
 assert.equal(merged.status,url);assert.equal(merged.sourcePrice,20);assert.equal(merged.engineCc,1968);
 for(const change of [{id:'other'},{lot:'43015008'},{lot:''},{table:'china'},{status:'Sold'},{status:'https://www.encar.com/another'}]){
  const current={...detail,...change};assert.equal(preserveKoreaListingLink(current,listed),current);
 }
 for(const status of ['',undefined,'https://encar.com.evil.test/','Sold'])assert.equal(preserveKoreaListingLink(detail,{...listed,status}),detail);
 const now=Date.now();assert.equal(newerKoreaDetail(listed,new Date(now-5000).toISOString(),{fullInformation:true,observedAt:new Date(now-1000).toISOString(),items:[detail]},now).status,url);
});
