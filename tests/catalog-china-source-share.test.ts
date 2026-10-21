import test from 'node:test';
import assert from 'node:assert/strict';
import {selectCatalogPublicationMix} from '../apps/web/lib/catalog/china-source-share';
test('new owner policy removes source-share and power quotas but preserves source scope',()=>{
 const rows=Array.from({length:100},(_,i)=>({id:String(i),market:'china',year:2026,sourceId:'autohome_new_china_open',powerHp:500}));
 const result=selectCatalogPublicationMix(rows as any,true);
 assert.equal(result.rows.length,100);assert.equal(result.sourceShare.removed.length,0);assert.equal(result.powerMix.removed.length,0);
 assert.deepEqual(selectCatalogPublicationMix(result.rows,true).rows,result.rows);
 const used={...rows[0],id:'used',mileageKm:10000};
 assert.deepEqual(selectCatalogPublicationMix([...rows,used] as any,true).sourceShare.removed,[used]);
});
