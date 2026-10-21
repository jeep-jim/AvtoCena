import test from 'node:test';
import assert from 'node:assert/strict';
import {newerKoreaDetail} from '../apps/web/lib/catalog/ajes-korea-detail-cache';
test('preview reuses newer opened full detail of same paid listing, never an unrelated or stale snapshot',()=>{
 const now=Date.now(),at=new Date(now-1000).toISOString(),old=new Date(now-5000).toISOString();
 const lot:any={table:'korea',id:'paid-audi',engineCc:1984,sourcePower:''};
 const detail={...lot,engineCc:1968,sourcePower:'190'};
 const saved={fullInformation:true,observedAt:at,items:[detail]};
 assert.equal(newerKoreaDetail(lot,old,saved,now),detail);
 for(const change of [{fullInformation:false},{stale:true},{partial:true},{items:[{...detail,id:'another'}]},{items:[{...detail,table:'china'}]},{observedAt:new Date(now-3600000).toISOString()},{observedAt:new Date(now+1000).toISOString()}])assert.equal(newerKoreaDetail(lot,old,{...saved,...change},now),lot);
 assert.equal(newerKoreaDetail(lot,new Date(now).toISOString(),saved,now),lot);
});
