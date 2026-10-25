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
test('older official tables and electric manufacturer types enter the same pre-pagination predicates',()=>{
 for(const [make,code,drive] of [['BMW','ZAA-72AW44','rwd'],['BMW','ABA-VA20','rwd'],['AUDI','ABA-4LBHKS','awd'],['Audi','8KCAB','fwd'],['Honda','RM7','fwd'],['Honda','CL9','fwd'],['Nissan','DBA-E11','fwd'],['Ford','ABA-WF0SFJ','fwd'],['Mitsubishi','ZAA-HD4W','rwd'],['Citroën','B75F01S','fwd'],['Renault','DZF4R','fwd'],['Citroen','ABA-A55F01','fwd'],['Citroen','ABA-A5HM01','fwd']] as const){
  assert.equal(lookupJapanChassisDrive(make,code),drive);
  assert.equal(enrichJapanDrive({market:'japan',make,chassisCode:code}).drive,drive);
  assert.ok(japanDriveSql(drive).includes(japanChassisCode(code)));
 }
 assert.equal(lookupJapanChassisDrive('Suzuki','CBA-HA24S'),undefined);
 assert.doesNotMatch(japanDriveSql('awd'),/HA24S/);
 assert.doesNotMatch(japanDriveSql('fwd'),/HA24S/);
});
test('reviewed CR-V codes enrich saved offers and enter source predicates without guessing shared Alto code',()=>{
 const o={market:'japan',make:'Honda',model:'CR-V',year:2009,chassisCode:'DBA-RE4'};
 assert.equal(enrichJapanDrive(o).drive,'awd');
 assert.equal(enrichJapanDrive({...o,chassisCode:'RE3'}).drive,'fwd');
 assert.equal(enrichJapanDrive({...o,trim:'4WD FWD'}).drive,undefined);
 assert.equal(enrichJapanDrive({...o,trim:'2WD'}).drive,undefined);
 assert.equal(enrichJapanDrive({...o,drive:'rwd'}).drive,'rwd');
 assert.equal(enrichJapanDrive({...o,operational:{raw:{sourceDrive:'FF'}}}).drive,'fwd');
 assert.match(japanDriveSql('awd'),/RE4/);
 assert.doesNotMatch(japanDriveSql('awd'),/HA36S/);
 assert.match(japanDriveSql('awd'),/not regexp/);
 assert.equal(lookupJapanChassisDrive('Honda','ZAA-ZC7'),'rwd');
});

test('full Alfa variant suffixes and factory drivetrains are preserved in lookup and SQL',()=>{
 for(const [make,code,drive] of [['Alfa Romeo','939EXB1B 19','fwd'],['Alfa Romeo','939EXG2B 28','awd'],['Alfa Romeo','949AXP1A','rwd'],['Alfa Romeo','949AXN1A','rwd'],['Alfa Romeo','949AXM2A','awd'],['Alfa Romeo','949AXL2A','awd'],['ISUZU','LDF-JVWE25','rwd'],['PEUGEOT','3LA-P545G06H','fwd']] as const){
  assert.equal(lookupJapanChassisDrive(make,code),drive);
  assert.equal(enrichJapanDrive({market:'japan',make,chassisCode:code}).drive,drive);
  assert.ok(japanDriveSql(drive).includes(japanChassisCode(code)));
 }
 for(const code of ['939EXB1B','939EXG2B','939EXN1B 57','949AXH2A','949AXA2A']) assert.equal(lookupJapanChassisDrive('Alfa Romeo',code),undefined);
});
