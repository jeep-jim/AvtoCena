import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function stageScheduleHelper(directory: string) {
 fs.mkdirSync(path.join(directory, 'scripts/lib'), {recursive:true});
 fs.mkdirSync(path.join(directory, 'scripts/catalog-next'), {recursive:true});
 fs.copyFileSync('scripts/lib/catalog-refresh-schedule.mjs', path.join(directory, 'scripts/lib/catalog-refresh-schedule.mjs'));
 fs.copyFileSync('scripts/catalog-next/market-policy.mjs', path.join(directory, 'scripts/catalog-next/market-policy.mjs'));
}

const workflow = fs.readFileSync(".github/workflows/catalog-republish-market-artifacts.yml", "utf8");

test('full rebuild collects one market at a time without reducing source capacity or cancelling active runs', () => {
 const source = fs.readFileSync('.github/workflows/catalog-five-market-full-rebuild.yml', 'utf8');
 const collect = source.slice(source.indexOf('\n  collect:'), source.indexOf('\n  publish:'));
 assert.match(collect, /max-parallel: 1\b/);
 assert.doesNotMatch(collect, /max-parallel: [2-9]/);
 assert.match(source, /group: catalog-six-market-quality-rebuild\n  cancel-in-progress: false/);
 assert.match(source, /CATALOG_REBUILD_TARGET_PER_SOURCE: '100000'/);
 assert.match(source, /CATALOG_PUBLISH_MAX_PER_MARKET: '100000'/);
 assert.match(source, /CATALOG_INTAKE_MAX_ROWS_PER_SOURCE: '100000'/);
 assert.match(fs.readFileSync('scripts/catalog-source-intake.mjs', 'utf8'), /CATALOG_INTAKE_MAX_ROWS_PER_SOURCE/);
 assert.match(collect, /timeout-minutes: 240/);
});

test('legacy default plan retains all four other markets and excludes independent China', () => {
 const source = fs.readFileSync('.github/workflows/catalog-five-market-full-rebuild.yml', 'utf8');
 const script = source.match(/node --input-type=module <<'JS'\n([\s\S]*?)\n\s+JS/)![1];
 const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-sequential-plan-'));
 try {
  stageScheduleHelper(directory);
 const output = path.join(directory, 'output');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
   cwd: directory, env: {...process.env, EVENT_NAME: 'schedule', GITHUB_OUTPUT: output}, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(output, 'utf8'), /^collect_markets=\["korea","uae","georgia","europe"\]$/m);
 } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});

test('five-market push reads its own reuse marker instead of starting another crawl', () => {
  const source = fs.readFileSync('.github/workflows/catalog-five-market-full-rebuild.yml', 'utf8');
  const script = source.match(/node --input-type=module <<'JS'\n([\s\S]*?)\n\s+JS/)![1];
  assert.match(script, /EVENT_NAME === 'push'/);
  assert.match(script, /readFileSync\('\.github\/market-runs\/five-market-full-rebuild\.json'/);
  assert.doesNotMatch(script, /weekly-six-market-catalog/);
  assert.match(source, /run-id: \$\{\{ needs\.plan\.outputs\.reuse_run_id \}\}/);
  assert.match(source, /const allowed = \['korea','uae','georgia','europe'\]/);
  assert.match(source, /fromJSON\(needs\.plan\.outputs\.collect_markets\)/);
});

test('a targeted UAE repair keeps its scope and rejects both Japan and independent China', () => {
  const source = fs.readFileSync('.github/workflows/catalog-five-market-full-rebuild.yml', 'utf8');
  const script = source.match(/node --input-type=module <<'JS'\n([\s\S]*?)\n\s+JS/)![1];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-plan-test-'));
  try {
    stageScheduleHelper(directory);
    const markers = path.join(directory, '.github/market-runs');
    fs.mkdirSync(markers, { recursive: true });
    const marker = path.join(markers, 'five-market-full-rebuild.json');
    const output = path.join(directory, 'output');
    fs.writeFileSync(marker, JSON.stringify({ publishMarkets: ['uae'] }));
    const run = () => spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: directory, env: { ...process.env, EVENT_NAME: 'push', GITHUB_OUTPUT: output }, encoding: 'utf8',
    });
    assert.equal(run().status, 0);
    const values = fs.readFileSync(output, 'utf8');
    assert.match(values, /^publish_markets=uae$/m);
    assert.match(values, /^collect_markets=\["uae"\]$/m);
    for(const market of ['japan','china']){
      fs.writeFileSync(marker, JSON.stringify({ publishMarkets: [market] }));
      assert.notEqual(run().status, 0);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("collected market artifacts can be republished without another source crawl", () => {
  assert.match(workflow, /\.github\/market-runs\/republish-artifacts/);
  assert.match(workflow, /permissions:\n  actions: read\n  contents: read/);
  assert.match(workflow, /run-id: \$\{\{ needs\.config\.outputs\.run_id \}\}/);
  assert.match(workflow, /pattern: catalog-v3-\$\{\{ needs\.config\.outputs\.market \}\}-\[0-4\]/);
  assert.match(workflow, /files\.length!==5\|\|total<=0/);
  assert.match(workflow, /npx tsx scripts\/catalog-publish-market\.mjs/);
  assert.match(workflow, /npx tsx scripts\/catalog-live-postpersist-audit\.mjs/);
  assert.doesNotMatch(workflow, /catalog-rebuild-source-shard\.mjs/);
  assert.match(workflow, /market === 'japan' \? '2592000000' : '1209600000'/);
  assert.match(workflow, /timeout-minutes: 120/);
  assert.match(workflow, /CATALOG_PUBLISH_LOCK_TTL_MS: "1800000"/);
  assert.match(workflow, /CATALOG_PUBLISH_LOCK_HEARTBEAT_MS: "300000"/);
});

test('each publication has a separate budget while downloads and writes remain market-scoped and sequential',()=>{
 const source=fs.readFileSync('.github/workflows/catalog-five-market-full-rebuild.yml','utf8');
 const publish=source.slice(source.indexOf('\n  publish:'));
 assert.match(publish,/timeout-minutes: 360/);
 assert.match(publish,/max-parallel: 1/);
 assert.match(publish,/fail-fast: false/);
 assert.match(publish,/pattern: catalog-intake-\$\{\{ matrix.market \}\}/);
 assert.match(publish,/contains\(fromJSON\(needs.plan.outputs.collect_markets\), matrix.market\)/);
 assert.match(publish,/catalog-storage-maintenance/);
 assert.match(publish,/catalog-storage-preflight/);
 assert.match(publish,/catalog-audit-visible-calculation-coverage/);
});

test('artifact config rejects China before output but preserves every other market and its retention',()=>{
 const script=workflow.match(/node <<'NODE'\n([\s\S]*?)\n\s+NODE/)![1];
 const execute=(market:string)=>{let output='';
  const fs={readFileSync:()=>{throw Error('unexpected marker');},appendFileSync:(_path:string,value:string)=>{output+=value;}};
  new Function('require','process',script)((name:string)=>{assert.equal(name,'fs');return fs;},
   {env:{DISPATCH_MARKET:market,DISPATCH_RUN_ID:'900',GITHUB_OUTPUT:'offline'}});
  return output;
 };
 assert.throws(()=>execute('china'),/republish_market_invalid:china/);
 for(const market of ['korea','japan','uae','europe','georgia'])
  assert.equal(execute(market),`market=${market}\nrun_id=900\nretention_ms=${market==='japan'?'2592000000':'1209600000'}\n`);
});

test('saved shared loops cannot publish China and changing their source cannot trigger neighbouring markets',()=>{
 const weekly=fs.readFileSync('.github/workflows/catalog-weekly-six-markets.yml','utf8');
 assert.match(weekly,/market: \[korea, uae, europe, georgia, japan\]/);
 assert.match(weekly,/for market in korea uae europe georgia japan; do/);
 const saved=fs.readFileSync('.github/workflows/publish-saved-six-market-complete-20260917.yml','utf8');
 const paths=saved.slice(saved.indexOf('    paths:'),saved.indexOf('permissions:'));
 assert.match(paths,/\.github\/market-runs\/publish-saved-six-market-complete-20260917\.json/);
 assert.doesNotMatch(paths,/\.github\/workflows/);
 assert.match(saved,/for market in europe korea uae georgia; do/);
 assert.match(saved,/for market in korea europe uae georgia japan; do/);
 assert.doesNotMatch(saved,/china/i);
});

test('retired owned China CLI writers and exact historical publication workflows are absent',()=>{
 for(const file of ['catalog-download-owned-china.mjs','catalog-prepare-owned-china.mjs','stage-owned-china-market.mjs','accept-owned-china-market.mjs','catalog-verify-owned-china.mjs'])
  assert.equal(fs.existsSync(path.join('scripts',file)),false);
 for(const file of ['china-saved-recovery83-20261117.yml','bounded-china-fresh-commit-v1.yml','bounded-china-fresh-commit-v2.yml','collect-china-ordinary-20261119.yml'])
  assert.equal(fs.existsSync(path.join('.github/workflows',file)),false);
 for(const file of ['scripts/lib/auto-api-che168-client.mjs','scripts/lib/nonjp-intake-archive.mjs','scripts/lib/owned-china-publication-source.mjs'])
  assert.equal(fs.existsSync(file),true);
});

test('direct legacy China publication rejects single and mixed scopes before any storage or network access',()=>{
 const source=fs.readFileSync('scripts/catalog-publish-market.mjs','utf8');
 const guard=source.indexOf('if (configuredMarkets.includes("china")) throw new Error("catalog_china_legacy_publication_retired");');
 assert.ok(guard>=0&&guard<source.indexOf("await bindFeedRates(market,'read')"));
 const script=`
  import assert from 'node:assert/strict';
  import {getJsonStorage} from './apps/web/lib/data.ts';
  const storage=getJsonStorage(), accesses=[];
  for(const name of new Set([...Object.getOwnPropertyNames(Object.getPrototypeOf(storage)),...Object.keys(storage)])){
   if(name==='constructor'||typeof storage[name]!=='function')continue;
   storage[name]=()=>{accesses.push(name);throw Error('unexpected_catalog_storage_access');};
  }
  globalThis.fetch=async()=>{accesses.push('fetch');throw Error('unexpected_catalog_network_access');};
  await assert.rejects(import('./scripts/catalog-publish-market.mjs'),{message:'catalog_china_legacy_publication_retired'});
  assert.deepEqual(accesses,[]);
 `;
 for(const selection of ['china',' china ','korea,china','china,uae']){
  const result=spawnSync(process.execPath,['--import','tsx','--import','./tests/helpers/offline-fetch.mjs','--input-type=module','-e',script],{
   cwd:process.cwd(),encoding:'utf8',timeout:30000,
   env:{PATH:process.env.PATH,NODE_ENV:'test',JSON_STORAGE_DRIVER:'local',CATALOG_REBUILD_MARKETS:selection,MARKET_RATE_RUN:'123'},
  });
  assert.equal(result.status,0,result.stderr||String(result.error));
 }
});
