import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ajesCatalogQuery,ajesQuery,AjesInputError} from '../apps/web/lib/catalog/ajes-query';
import {findSavedAjesSearch} from '../apps/web/lib/catalog/ajes-saved-search';
import {japanChassisSearchSql,matchesJapanSearchChassis} from '../apps/web/lib/catalog/japan-chassis-search';

function database() {
  const db = new DatabaseSync(':memory:');
  db.function('regexp', (pattern, value) => value === null ? null : Number(new RegExp(String(pattern), 'i').test(String(value))));
  db.exec(`create table stats (
    id text, marka_name text, model_name text, year integer, auction_type integer,
    status text, finish integer, auction_date text, kuzov text collate nocase,
    serial text, lot text
  )`);
  return db;
}

test('Japan lists, counts, pagination and saved recovery use the same complete chassis code', () => {
  const codes = ['LA350A','DBA-LA350A','5BA-LA350A','HBD-LA350A','LDA-LA350A',
    'LA350AX','XLA350A','LA350A-012345','X-DBA-LA350A','XYZ-LA350A','LA360A'];
  const db = database(), insert = db.prepare('insert into stats values(?,?,?,?,?,?,?,?,?,?,?)');
  const observedAt = new Date().toISOString();
  const snapshots = Object.fromEntries(codes.map((code, i) => {
    const id = `lot${String(i).padStart(3, '0')}`;
    insert.run(id,'DAIHATSU','MIRA ES',2020,0,'Sold',500000,'2026-11-09',code,'LA350A-012345','002910');
    return [id, {observedAt, items: [{id, table:'stats',make:'DAIHATSU',model:'MIRA ES',year:2020,
      status:'Sold',finalPriceJpy:500000,auctionDate:'2026-11-09',chassisCode:code,frameNumber:'LA350A-012345',lot:'002910'}]}];
  }));
  try {
    for (const chassis of ['LA350A','DBA-LA350A','5BA-LA350A',' ｌａ３５０ａ ']) {
      const input = ajesCatalogQuery({market:'japan',chassis,lotNumber:'002910',pageSize:'2'});
      const list = (page: number) => db.prepare(ajesQuery({...input,page}).sql).all().map(row=>row.id);
      assert.deepEqual(list(1), ['lot000','lot001']);
      assert.deepEqual(list(2), ['lot002','lot003']);
      assert.deepEqual(list(3), ['lot004']);
      const count = db.prepare(ajesQuery({...input,aggregate:'count'}).sql).get();
      assert.equal(count?.['count(*)'], 5);
      const models = db.prepare(ajesQuery({...input,aggregate:'models'}).sql).all();
      assert.equal(models[0]['count(*)'], 5);
      const saved = findSavedAjesSearch({...input,pageSize:24}, snapshots)!;
      assert.deepEqual(saved.items.map(row=>row.id), ['lot000','lot001','lot002','lot003','lot004']);
      assert.equal(saved.partial,true);assert.equal(saved.stale,true);
      assert.equal('total' in saved,false);
    }
    assert.equal(findSavedAjesSearch({chassis:'LA350A',lotNumber:'2910'},snapshots),null,'lot leading zeros remain exact');
    assert.equal(findSavedAjesSearch({chassis:'LA350A',frameNumber:'LA350A-012346'},snapshots),null,'full frame remains exact');
  } finally {db.close();}
});

test('numeric and unknown chassis formats never consume frame numbers or partial codes', () => {
  const pairs: Array<[string,string,boolean]> = [
    ['SKE-012345','012345',false],['012345','SKE-012345',false],
    ['SKE-012345','SKE-012345',true],['DBA-SKE','SKE',true],
    ['955142','ABA-955142',true],['ABA-955142','955142',true],
    ['9551420','955142',false],['X-955142','955142',false],
    ['XYZ-LA350A','LA350A',false],['XYZ-LA350A','XYZ-LA350A',true],
    ['939EXB1B 19','939EXB1B 19',true],['939EXB1B 190','939EXB1B 19',false],
  ];
  const db=database(),insert=db.prepare('insert into stats values(?,?,?,?,?,?,?,?,?,?,?)');
  try {
    for (const [source,query,expected] of pairs) {
      db.exec('delete from stats');
      insert.run('one','TOYOTA','TEST',2020,0,'Sold',1,'2026-11-09',source,'','');
      const sqlMatch = db.prepare('select id from stats where '+japanChassisSearchSql(query)).all().length === 1;
      assert.equal(sqlMatch,expected,`${source}/${query} SQL`);
      assert.equal(matchesJapanSearchChassis(source,query),expected,`${source}/${query} saved`);
    }
  } finally {db.close();}
});

test('chassis expansion stays Japan-only, bounded and cannot interpret SQL or wildcard input', () => {
  for (const table of ['stats','main'] as const) for (const aggregate of [undefined,'count'] as const) {
    const sql=ajesQuery({table,aggregate,chassis:'DBA-LA350A',frameNumber:'LA350A-012345',lotNumber:'002910'}).sql;
    assert.match(sql,/kuzov='LA350A'/);assert.match(sql,/serial='LA350A-012345'/);assert.match(sql,/lot='002910'/);
    assert.doesNotMatch(sql,/kuzov like/i);
    assert.ok(new URLSearchParams({sql}).toString().length<8000,'keep the complete source query below its URI budget');
  }
  for (const table of ['china','korea'] as const) {
    const sql=ajesQuery({table,chassis:'DBA-LA350A'}).sql;
    assert.match(sql,/kuzov='DBA-LA350A'/);assert.doesNotMatch(sql,/kuzov regexp/);
  }
  assert.doesNotMatch(ajesQuery({}).sql,/kuzov/,'unfiltered saved-query identity is unchanged');
  for (const chassis of ["LA350A' OR 1=1",'LA350%','LA350_','LA350.*','LA350A\nBAD','A'.repeat(81)]) {
    assert.equal(japanChassisSearchSql(chassis),null);
    assert.equal(matchesJapanSearchChassis('LA350A',chassis),false);
    assert.throws(()=>ajesQuery({chassis}),AjesInputError);
  }
});
