import test from 'node:test';import assert from 'node:assert/strict';
import {japanChassisCode,lookupJapanChassisDrive,type ChassisDriveRow} from '../apps/web/lib/encyclopedia/japan-chassis-drive';
const table:ChassisDriveRow[]=[{make:'Honda',chassisCode:'RE4',drives:['awd']},{make:'Suzuki',chassisCode:'HA36S',drives:['fwd','awd']},{make:'Mazda',chassisCode:'RE4',drives:['fwd']}];
test('official type lookup qualifies make, preserves conflicting drive and handles emission prefix',()=>{
 assert.equal(lookupJapanChassisDrive('HONDA','DBA-RE4',table),'awd');
 assert.equal(lookupJapanChassisDrive('Mazda','RE4',table),'fwd');
 assert.equal(lookupJapanChassisDrive('Toyota','RE4',table),undefined);
 assert.equal(lookupJapanChassisDrive('Suzuki','5BA-HA36S',table),undefined);
 assert.equal(lookupJapanChassisDrive('Honda','RE3',table),undefined);
 assert.equal(japanChassisCode(' LDA-DJ5AS '),'DJ5AS');
});
import {enrichJapanDrive,japanDriveSql} from '../apps/web/lib/catalog/japan-drive';
test('reviewed CR-V codes enrich saved offers and enter source predicates without guessing shared Alto code',()=>{
 const o={market:'japan',make:'Honda',model:'CR-V',year:2009,chassisCode:'DBA-RE4'};
 assert.equal(enrichJapanDrive(o).drive,'awd');
 assert.equal(enrichJapanDrive({...o,chassisCode:'RE3'}).drive,'fwd');
 assert.equal(enrichJapanDrive({...o,trim:'4WD FWD'}).drive,undefined);
 assert.equal(enrichJapanDrive({...o,trim:'2WD'}).drive,undefined);
 assert.equal(enrichJapanDrive({...o,drive:'rwd'}).drive,'rwd');
 assert.equal(enrichJapanDrive({...o,operational:{raw:{sourceDrive:'FF'}}}).drive,'fwd');
 assert.match(japanDriveSql('awd'),/'RE4'/);
 assert.doesNotMatch(japanDriveSql('awd'),/'HA36S'/);
 assert.match(japanDriveSql('awd'),/not \(/);
 assert.equal(lookupJapanChassisDrive('Honda','ZAA-ZC7'),'rwd');
});
