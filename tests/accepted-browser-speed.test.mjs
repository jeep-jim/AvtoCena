import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {acceptedBrowserSpeed} from '../scripts/lib/accepted-browser-speed.mjs';
const read=(name)=>JSON.parse(fs.readFileSync('docs/operations/'+name,'utf8'));
const baseline=read('2026-11-11-accepted-browser-speed-baseline.json');
test('restored exact release passes original browser envelope',()=>{
 const restored=read('2026-11-11-accepted-speed-browser-restored.json');
 assert.equal(acceptedBrowserSpeed(restored,baseline).passed,true);
});
test('real 60-second report fails despite correct visible card prices',()=>{
 const slow=read('2026-11-11-budget-browser-idle.json');
 assert.equal(slow.passed,true);
 const result=acceptedBrowserSpeed(slow,baseline);
 assert.equal(result.passed,false);
 assert.ok(result.checks.some(r=>r.width===390&&r.scenario==='budget:2000000'&&r.seconds===60.105&&!r.passed));
});
test('failed, incomplete, wrong-price, empty or substituted-baseline reports fail closed',()=>{
 const good=read('2026-11-11-accepted-speed-browser-restored.json');
 for(const change of [
  r=>r.browserPassed=false,r=>r.error='functional failure',r=>r.checks.pop(),
  r=>r.checks[0].filters.pop(),r=>r.checks[0].filters[0].largestPrice=1500001,
  r=>r.checks[0].filters[0].cards=0,r=>r.checks[0].pageErrors.push('crash'),
  r=>r.checks[0].filters[0].seconds=NaN]){
  const v=structuredClone(good);change(v);assert.throws(()=>acceptedBrowserSpeed(v,baseline));
 }
 assert.throws(()=>acceptedBrowserSpeed(good,{...baseline,release:'3048aede91dbfa4287e038075700e1434ba53e85'}));
});
test('a fast duplicate catalog or preview request fails the original request budget',()=>{
 const good=read('2026-11-11-accepted-speed-browser-restored.json');
 for(const path of ['/cars/china','/api/catalog/search','/api/catalog/saved-previews']){
  const report=structuredClone(good),row=report.checks[0].filters[0];
  row.paths.push(path);row.requests++;
  const result=acceptedBrowserSpeed(report,baseline);
  assert.equal(result.passed,false,path);
  assert.ok(result.requestChecks.some(check=>!check.passed&&check.width===390&&check.budget===1500000));
  assert.ok(result.checks.every(check=>check.passed),'fast timing must not hide duplicate work');
 }
});
test('request budgets allow cached navigation and do not count unrelated hover or account work',()=>{
 const good=read('2026-11-11-accepted-speed-browser-restored.json');
 for(const check of good.checks)for(const row of check.filters){
  row.paths=['/account','/api/auth/me','/cars/offer/current-visible-car'];row.requests=row.paths.length;
 }
 const result=acceptedBrowserSpeed(good,baseline);
 assert.equal(result.passed,true);
 assert.ok(result.requestChecks.every(check=>check.requests===0&&check.ceilingRequests===1));
});
test('missing or inconsistent request evidence cannot disable amplification protection',()=>{
 const good=read('2026-11-11-accepted-speed-browser-restored.json');
 for(const change of [r=>delete r.paths,r=>r.requests++,r=>r.requests=-1,r=>r.paths.push(null)]){
  const report=structuredClone(good);change(report.checks[0].filters[0]);
  assert.throws(()=>acceptedBrowserSpeed(report,baseline),/request/);
 }
 const brokenBaseline=structuredClone(baseline);delete brokenBaseline.checks[0].filters[0].paths;
 assert.throws(()=>acceptedBrowserSpeed(good,brokenBaseline),/request/);
});
