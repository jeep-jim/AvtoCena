import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {checkedJapanPaginationBrowserFixture, readJapanPaginationFixture, JAPAN_PAGINATION_FIXTURE_MAX_BYTES}
  from '../scripts/catalog-next/japan-pagination-fixture.mjs';

const fixture = () => ({version:1,kind:'japan-pagination24-browser-v1',passed:true,caseCount:8,widths:[390,1440],
  checks:Object.fromEntries(['refill24','numberedContinuation','appendNoDuplicatesOrGaps','finiteExhaustion',
    'unknownPowerPreserved','failureHonesty','cursorBinding','warningRemoved','sourcePageSize24',
    'neighborPaginationPreserved','noExternalRequests'].map(key=>[key,true]))});
const powerFixture = () => ({...fixture(),version:2,kind:'japan-pagination24-browser-v2',caseCount:12,
  checks:{...fixture().checks,knownBeforeUnknown:true,boundedKnownContinuation:true,evidenceEpochReset:true}});
const refused = fn => assert.throws(fn,/^Error: japan_pagination_fixture_[a-z_]+$/);
async function directory(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'japan-pagination-fixture-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;
}

test('pagination fixture proves both viewports and all ordinary-source continuation scenarios',()=>{
  assert.deepEqual(checkedJapanPaginationBrowserFixture(fixture()),fixture());
  for(const patch of [{version:2},{kind:'japan-photo-retry-browser-v1'},{passed:false},{caseCount:7},{caseCount:'8'},
    {widths:[1440,390]},{widths:[390]},{widths:[390,1440,800]},{extra:true}])
    refused(()=>checkedJapanPaginationBrowserFixture({...fixture(),...patch}));
  for(const key of Object.keys(fixture().checks))
    for(const value of [false,1,'true',undefined])
      refused(()=>checkedJapanPaginationBrowserFixture({...fixture(),checks:{...fixture().checks,[key]:value}}));
  refused(()=>checkedJapanPaginationBrowserFixture({...fixture(),checks:{...fixture().checks,extra:true}}));
});

test('untrusted getters and private extras cannot be invoked or copied',()=>{
  let reads=0;const report=fixture();
  Object.defineProperty(report.checks,'sourcePageSize24',{enumerable:true,get(){reads++;return true;}});
  refused(()=>checkedJapanPaginationBrowserFixture(report));
  refused(()=>checkedJapanPaginationBrowserFixture({...fixture(),password:'private-secret'}));
  assert.equal(reads,0);
});

test('power order requires the complete v2 evidence without changing historical v1',()=>{
  assert.deepEqual(checkedJapanPaginationBrowserFixture(powerFixture(),{requirePowerOrder:true}),powerFixture());
  assert.deepEqual(checkedJapanPaginationBrowserFixture(powerFixture()),powerFixture());
  assert.deepEqual(checkedJapanPaginationBrowserFixture(fixture()),fixture());
  refused(()=>checkedJapanPaginationBrowserFixture(fixture(),{requirePowerOrder:true}));
  for(const change of [{version:1},{kind:'japan-pagination24-browser-v1'},{caseCount:8},{caseCount:11},{passed:false}])
    refused(()=>checkedJapanPaginationBrowserFixture({...powerFixture(),...change},{requirePowerOrder:true}));
  for(const key of Object.keys(powerFixture().checks))for(const value of [false,undefined,1,'true'])
    refused(()=>checkedJapanPaginationBrowserFixture({...powerFixture(),checks:{...powerFixture().checks,[key]:value}},{requirePowerOrder:true}));
  refused(()=>checkedJapanPaginationBrowserFixture({...powerFixture(),checks:{...powerFixture().checks,extra:true}}));
  let reads=0;const report=powerFixture();
  Object.defineProperty(report.checks,'evidenceEpochReset',{enumerable:true,get(){reads++;return true;}});
  refused(()=>checkedJapanPaginationBrowserFixture(report,{requirePowerOrder:true}));
  assert.equal(reads,0);
});

test('reader preserves exact bounded fixture bytes',async t=>{
  const dir=await directory(t),file=path.join(dir,'report.json'),raw=Buffer.from(JSON.stringify(fixture(),null,2)+'\n');
  await fs.writeFile(file,raw);assert.deepEqual(await readJapanPaginationFixture(file),raw);
  const padded=Buffer.concat([raw,Buffer.alloc(JAPAN_PAGINATION_FIXTURE_MAX_BYTES-raw.length,32)]);
  await fs.writeFile(file,padded);assert.deepEqual(await readJapanPaginationFixture(file),padded);
});

test('the bounded file reader enforces the required power version before publication',async t=>{
  const dir=await directory(t),file=path.join(dir,'report.json');
  await fs.writeFile(file,JSON.stringify(fixture()));
  await assert.rejects(readJapanPaginationFixture(file,{requirePowerOrder:true}),/power_order_required/);
  const raw=Buffer.from(JSON.stringify(powerFixture()));await fs.writeFile(file,raw);
  assert.deepEqual(await readJapanPaginationFixture(file,{requirePowerOrder:true}),raw);
  await fs.writeFile(file,JSON.stringify({...powerFixture(),checks:{...powerFixture().checks,knownBeforeUnknown:false}}));
  await assert.rejects(readJapanPaginationFixture(file,{requirePowerOrder:true}),/fixture_checks/);
});

test('missing, oversized, malformed and incomplete fixture reports cannot reach host publication',async t=>{
  const dir=await directory(t),file=path.join(dir,'report.json');
  await assert.rejects(readJapanPaginationFixture(file),/japan_pagination_fixture_/);
  await assert.rejects(readJapanPaginationFixture(dir),/japan_pagination_fixture_/);
  for(const raw of [Buffer.alloc(JAPAN_PAGINATION_FIXTURE_MAX_BYTES+1,32),Buffer.from('not JSON'),Buffer.from([0xff]),
    Buffer.from(JSON.stringify({...fixture(),checks:{...fixture().checks,failureHonesty:false}}))]){
    await fs.writeFile(file,raw);await assert.rejects(readJapanPaginationFixture(file),/japan_pagination_fixture_/);
  }
});

test('symlink, hardlink and noncanonical artifact paths are rejected',async t=>{
  const dir=await directory(t),file=path.join(dir,'report.json'),alias=path.join(dir,'alias.json');
  await fs.writeFile(file,JSON.stringify(fixture()));
  await fs.symlink(file,alias);await assert.rejects(readJapanPaginationFixture(alias),/japan_pagination_fixture_/);
  await fs.unlink(alias);await fs.link(file,alias);
  await assert.rejects(readJapanPaginationFixture(file),/japan_pagination_fixture_/);
  await fs.unlink(alias);
  await assert.rejects(readJapanPaginationFixture(dir+'/./report.json'),/japan_pagination_fixture_/);
  await assert.rejects(readJapanPaginationFixture('report.json'),/japan_pagination_fixture_/);
});
