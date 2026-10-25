import test from 'node:test';import assert from 'node:assert/strict';
import {compileModelFacts,checksum,type CalculationIndex} from '../apps/web/lib/encyclopedia/calculation-index';
import {enrichJapanDrive,explicitJapanDrive,japanDriveSql} from '../apps/web/lib/catalog/japan-drive';
import {ajesQuery} from '../apps/web/lib/catalog/ajes-query';
function index(variants:any[]):CalculationIndex{const models={x:compileModelFacts({id:'m',make:'Suzuki',model:'Alto',revision:'r',variants:variants.map((v,i)=>({id:String(i),year:2023,trim:'equipment '+i,status:'observed',markets:['china'],chassisCode:'HA37S',...v}))})};return {version:1,digest:checksum(models),manifestDigest:'m',createdAt:'now',models};}
const offer={market:'japan',make:'Suzuki',model:'Alto',year:2023,trim:'L',operational:{chassisCode:'5BA-HA37S'}};
test('shared chassis never selects between FWD and AWD or undocumented drive',()=>{
 for(const second of ['awd',undefined])assert.equal(enrichJapanDrive(offer,index([{drive:'fwd'},{drive:second,fuel:'petrol'}])).drive,undefined);
 assert.equal(enrichJapanDrive(offer,index([{drive:'fwd'},{}])).drive,undefined);
 const known=index([{drive:'fwd'},{drive:'fwd'}]);assert.equal(enrichJapanDrive(offer,known).drive,'fwd');
 for(const patch of [{year:2022},{model:'Lapin'},{make:'Toyota'},{operational:{chassisCode:'HA97S'}}])assert.equal(enrichJapanDrive({...offer,...patch},known).drive,undefined);
 assert.equal(enrichJapanDrive({...offer,drive:'awd'},known).drive,'awd');
});
test('explicit source drive works independently of trim naming and never guesses 2WD',()=>{
 assert.equal(explicitJapanDrive('Coolmen Prestige 4WD'),'awd');
 for(const name of ['2WD','COMFORT','AWD FWD','4WD 2WD','FFLINE'])assert.equal(explicitJapanDrive(name),undefined);
 assert.equal(enrichJapanDrive({...offer,trim:'L 4WD'},index([{drive:'fwd'},{drive:'awd'}])).drive,'awd');
 assert.equal(enrichJapanDrive({...offer,trim:'L 4WD'},index([{drive:'fwd'}])).drive,'awd');
});
test('Japan drive predicate precedes pagination and count; Korea retains its source column',()=>{
 for(const aggregate of [undefined,'count'] as const){const query=ajesQuery({drive:'awd',aggregate});assert.match(query.sql,/grade like/);assert.match(query.sql,/priv in/);if(!aggregate)assert.ok(query.sql.indexOf('grade like')<query.sql.indexOf('limit'));}
 assert.match(ajesQuery({table:'korea',drive:'awd'}).sql,/priv in/);
 const sql=japanDriveSql('fwd',index([{drive:'fwd'}]));assert.match(sql,/marka_name='SUZUKI' and model_name='ALTO' and year=2023 and \(kuzov='HA37S'/);
 assert.throws(()=>japanDriveSql("awd' OR 1=1"));
});
