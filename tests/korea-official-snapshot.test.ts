import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOfficialPowerSnapshot} from '../scripts/lib/korea-official-power-snapshot.mjs';
const row={RECP_NO:'1',COMP_NM:'Hyundai',MODL_NM:'Avante',ENG_TYPE:'G4FM',BAEGI_AMT:'1598',FUEL_KIND_NM:'휘발유',CAR_TYPE_NM:'내연기관',TOP_OUT:'123/6300',OPEN_DT:'20200101',OPEN_YY:'2020'};
const rows=Array.from({length:3100},(_,i)=>({...row,RECP_NO:String(i)}));
const metadata={capturedAt:'2026-09-20T00:00:00Z',rawSha256:'new',unitHtml:'최고출력(ps/rpm) rslt.TOP_OUT'};
test('official snapshot preserves engine codes, units, historical and conflicting ratings',()=>{
 const first=buildOfficialPowerSnapshot(rows,{records:[],rawSha256:'old'},metadata);
 assert.equal(first.records[0].output,'123/6300');assert.equal(first.records[0].engineCode,'G4FM');
 const changed=rows.map(r=>({...r,TOP_OUT:'130/6300'}));
 const next=buildOfficialPowerSnapshot(changed,first,metadata);
 assert.equal(next.records.length,6200);assert.equal(next.records.filter(r=>r.id==='0').length,2);
 assert.deepEqual(new Set(next.records.map(r=>r.output)),new Set(['123/6300','130/6300']));
});
test('incomplete response, lost power fields, or changed unit cannot replace the reference',()=>{
 const previous={records:[],rawSha256:'old'};
 assert.throws(()=>buildOfficialPowerSnapshot(rows.slice(0,10),previous,metadata),/collapse/);
 assert.throws(()=>buildOfficialPowerSnapshot(rows,previous,{...metadata,unitHtml:'maximum power kW'}),/unit_unverified/);
 assert.throws(()=>buildOfficialPowerSnapshot(rows.map(r=>({...r,ENG_TYPE:''})),previous,metadata),/fields_missing/);
 assert.deepEqual(previous,{records:[],rawSha256:'old'});
});
