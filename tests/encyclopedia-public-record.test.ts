import test from 'node:test';
import assert from 'node:assert/strict';
import {publicEncyclopediaRecord} from '../apps/web/lib/encyclopedia/public-record';
import {fieldGroups,editorFieldGroups} from '../apps/web/lib/encyclopedia/presentation';
test('public encyclopedia excludes nested provenance and notes without mutating stored evidence',()=>{
 const v:any={id:'v',markets:['china'],status:'review',observedCount:1,year:2026,powerKw:80,sourceUrl:'https://private-source.test/file.csv',notes:'Internal supplier',referenceEvidence:[{url:'secret'}],astraEvidence:{sourceUrl:'secret',manufactureYears:[2025]},astraIdentity:{approval:'ABC',url:'secret'}};
 const record:any={id:'m',make:'VW',model:'LT',photo:'',revision:'r',updatedAt:'now',editedBy:'owner',previousKey:'secret',variants:[v]};
 const snapshot=JSON.stringify(record),out=publicEncyclopediaRecord(record),json=JSON.stringify(out);
 assert.doesNotMatch(json,/secret|private-source|Internal supplier|sourceUrl|referenceEvidence|editedBy|previousKey/);
 assert.equal(out.variants[0].powerKw,80);assert.equal(out.variants[0].power30MinKw,undefined);assert.deepEqual(out.variants[0].astraEvidence,{manufactureYears:[2025]});assert.equal(JSON.stringify(record),snapshot);
 assert.ok(!fieldGroups.flatMap(g=>[...g.fields] as string[]).includes('sourceUrl'));
 assert.ok(editorFieldGroups.flatMap(g=>[...g.fields] as string[]).includes('sourceUrl'));
});
