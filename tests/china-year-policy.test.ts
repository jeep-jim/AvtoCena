import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogInventoryAgeDecision as age} from '../apps/web/lib/catalog/inventory-admission';
import {PUBLIC_CATALOG_MARKETS} from '../apps/web/lib/catalog/runtime-config';
import {CHINA_MIN_MODEL_YEAR} from '../apps/web/lib/catalog/china-year-policy';
import {autoApiChe168Resume} from '../scripts/lib/auto-api-che168-client.mjs';
const now=new Date('2026-10-21T05:00:00Z');
test('China includes 2014 through current year independently of six-year age',()=>{
 for(const year of [2014,2019,2020,2026])assert.equal(age({market:'china',year,productionDate:`${year}-01-01`},now).eligible,true);
 for(const year of [2013,2027,0,NaN])assert.equal(age({market:'china',year},now).eligible,false);
 assert.equal(age({market:'china',year:2026,productionDate:'2026-12-01'},now).eligible,false);
 assert.equal(age({market:'china',year:2014},new Date('2027-10-21')).eligible,true);
 assert.equal(age({market:'korea',year:2014},now).eligible,false);
});
test('China leads public order, complete Japan precedes Korea',()=>{
 assert.deepEqual(PUBLIC_CATALOG_MARKETS,['china','japan','korea','uae','europe','georgia']);
});
test('older narrower feed cursor cannot skip newly allowed China years',()=>{
 const saved={version:1,market:'china',generationId:'fixture',updatedAt:now.toISOString(),sources:[{sourceId:'autohome_used_china_open',provider:'auto_api_che168',yearFrom:2020,cursor:20,snapshotStartedAt:now.toISOString(),stopReason:'source_changes_finished'}]};
 assert.ok(autoApiChe168Resume(saved,{yearFrom:2020,now:now.getTime()}));
 assert.equal(autoApiChe168Resume(saved,{yearFrom:CHINA_MIN_MODEL_YEAR,now:now.getTime()}),null);
});
