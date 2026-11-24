import reviewedFilterBlobs from './catalog-search-source-diff.json' with {type:'json'};
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const HOME_UI = Object.freeze({
  source:'a05987cc725c950614ac7310c7de782b73cb093a',
  tree:'3fbbe83eae9ef85ffdbddd2cda6867541d2f3b39',
  retainedSource:'22867cbcfaee27b2e8917b6bf880e44827f67b60',
  retainedTree:'cb53c3c2b2ae656e3cabff8c63e78705e74314ba',
  sourceCalculationVersion:'641d3f80aec3941af84eae8c3471b806909ae04f580d7b5c6ca0085a4d01f238',
  servingCalculationVersion:'4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90',
  calculationAlgorithmBlob:'63c9323ac7a0ddf267a725443ca2316c197cc7d8',
  codeDiffSha256:'daf75be95dee034abbf282ff9d46cc8db92feed7f63177bb9765755b5391a163',
  privateIndexDigest:'bf2c72cb7a260ef093c0a43c2b0dad9c4c9094a4d6dc3811dd0d7f7626b0d72b',
  privateIndexParent:'83ff17075e9188dcf227c8752dc064248d5f42e0',
  sourceClosureRecords:6364,
  codePaths:Object.freeze([
    ".github/workflows/verify-korea-reports.yml",
    "apps/web/app/(public)/api/catalog/search/route.ts",
    "apps/web/app/(public)/cars/offer/[id]/history-identity.ts",
    "apps/web/app/(public)/cars/offer/[id]/page.tsx",
    "apps/web/app/(public)/page.tsx",
    "apps/web/app/api/catalog/home/route.ts",
    "apps/web/app/api/catalog/korea-report/paid-report-reader.ts",
    "apps/web/app/api/catalog/korea-report/route.ts",
    "apps/web/app/api/catalog/recommendations/data.ts",
    "apps/web/components/catalog/CatalogContent.tsx",
    "apps/web/components/catalog/KoreaReportPanel.tsx",
    "apps/web/components/catalog/PaidKoreaReportPanel.tsx",
    "apps/web/components/catalog/paid-korea-report-contract.ts",
    "apps/web/components/home/useHomeCatalogCount.ts",
    "apps/web/lib/catalog/ajes-public.ts",
    "apps/web/lib/catalog/ajes-runtime.ts",
    "apps/web/lib/catalog/ajes-saved-power-page.ts",
    "apps/web/lib/catalog/ajes-saved-search.ts",
    "apps/web/lib/catalog/china-public-aggregate.ts",
    "apps/web/lib/catalog/china-regcloud-object-reader.ts",
    "apps/web/lib/catalog/count-format.ts",
    "apps/web/lib/catalog/home-card-payload.ts",
    "apps/web/lib/catalog/independent-market-activation-fixture.ts",
    "apps/web/lib/catalog/market-selection.ts",
    "apps/web/lib/catalog/prepared-china-filter-index.ts",
    "apps/web/lib/catalog/prepared-china-fixture-activation.ts",
    "apps/web/lib/catalog/prepared-china-http-fixture.ts",
    "apps/web/lib/catalog/related-offer-selection.ts",
    "apps/web/lib/catalog/serving-china-filter-index.ts",
    "apps/web/lib/catalog/storage.ts",
    "scripts/build-serving-china-filter-index.mts",
    "tests/ajes-saved-power-page.test.ts",
    "tests/browser/paid-korea-report-fixture.tsx",
    "tests/browser/paid-korea-report-live.mjs",
    "tests/browser/paid-korea-report.mjs",
    "tests/catalog-budget-combined.test.ts",
    "tests/catalog-china-aggregate-authority.test.ts",
    "tests/catalog-china-common-grid.test.ts",
    "tests/catalog-china-default-showcase.test.ts",
    "tests/catalog-current-read-model-empty-market-policy.test.ts",
    "tests/catalog-editable-power-scenario.test.ts",
    "tests/catalog-japan-filter-rail.test.ts",
    "tests/catalog-market-page-boundary.test.ts",
    "tests/catalog-source-qualification-contract.test.ts",
    "tests/china-verified-object-reads.test.ts",
    "tests/fixtures/paid-korea-report.json",
    "tests/home-card-payload.test.ts",
    "tests/home-editorial-empty.test.ts",
    "tests/home-initial-catalog.test.ts",
    "tests/offer-navigation-performance.test.ts",
    "tests/paid-korea-report-contract.test.ts",
    "tests/paid-korea-report-live.test.ts",
    "tests/paid-korea-report-reader.test.ts",
    "tests/paid-korea-report-recommendations.test.ts",
    "tests/paid-korea-report-render.test.ts",
    "tests/prepared-china-filter-index.test.ts",
    "tests/public-page-recovery.test.ts",
    "tests/related-offer-selection.test.ts"
]),
});

export const HOME_RUNTIME = Object.freeze({
  nginxSha256:'b55e61e9686c639d9f0deac678b881ec56633e1cfd2b4703084b0ad9aaecaf6f',
  serving:{name:'avtocena-china-grid-dark-22867cbcfaee', release:HOME_UI.retainedSource, port:3002,
    // Same serving image and container after the observed 12:00 UTC restart. See the reviewed process inventory.
    restartCount:4, startedAt:'2026-11-23T12:00:23.582641254Z',
    id:'52e44ba2810796f9a12ac83984d9571f71ac1290d852206d2a259ad44da02a8d',
    image:'sha256:8a7326fc17de9a28ae66a4915e68038ac089ba4cdf2954bd7fcbd7cbda46ccf8'},
  chinaRollback:{name:'avtocena-china-candidate-85296f6b8797', release:'85296f6b8797aaa93227b69da7e9e9e928e8f9b5', port:3000,
    image:'sha256:0bfe542a991a69aaa4f416726a221e4e845986cc15c98a414e24ea7cff462984'},
  legacyRollback:{name:'avtocena-production', release:HOME_UI.privateIndexParent, port:3001,
    image:'sha256:4a055ba772496c7de89594acbbc1c1bc02ac2d2b20050cfad7f637d1f5646dfd'},
});

// These existing acceptance programs stay independent of the application tree.
// The three extra server paths are restored by the core gate from its frozen
// baseline; an empty market scope and that baseline produce all 17 routes.
// The reviewed 24.11 market-scope fix changes only scoped selection. This
// controller still forces full scope; its source, approval and baseline pins
// remain separate from the exact shared executable digest below.
export const GATE_FILES = Object.freeze({
  'scripts/regcloud-performance-gate.py':'bbe1bac67ae9ca525fb794b264aa26bf6b8b0ab21ec015b245abe7a7b7a679c3',
  'scripts/regcloud-browser-verdict.py':'48853ef1f58e1cac5c3270adf8f03f7103b29ed83d8b1fb8d03573774cca827b',
  'scripts/regcloud-deploy-with-browser.sh':'8cc38243b319b66d98dac23a5e8c9a91a59e0a90fdf3ace3db58ffd79537d266',
  'scripts/verify-frozen-speed-baselines.mjs':'aff727f9b4ff5b26d875e887305ae850eb727585880595ac3d34ca774c19d38f',
  'tests/browser/owner-filter-speed-live.mjs':'df6b0a0294e88a9985e85f383b9b2ca45b7da49740701a3d53cce0b3f45d490a',
  'scripts/lib/accepted-browser-speed.mjs':'b9f7894e262002fc9bca13eace09ab237f982c80862d37fcf6292f91774e34bd',
  'docs/operations/2026-11-11-accepted-speed-baseline.json':'32fba449b77e40983803483ea7b6cb4ece09afa997c2ae08dd968c675f528c59',
  'docs/operations/2026-11-11-accepted-browser-speed-baseline.json':'1ad263a9f9c6c4d656ffec4aca51d2b96f5fd284afb759e96ae53cee2bf39b06',
});
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const need = (value, code) => { if (!value) throw Error('home_ui_' + code); };
const git = (root, args) => execFileSync('git', args, {cwd:root, encoding:'utf8', maxBuffer:32*1024*1024});
const codeRoots = ['apps','packages','scripts','tests','.github/workflows'];

function calculationRecords(root, ref) {
  return git(root, ['ls-tree','-rz','--full-tree',ref]).split('\0').filter(Boolean).filter(record => {
    const name = record.slice(record.indexOf('\t') + 1);
    return /^(?:apps\/web\/lib\/|packages\/|data\/|scripts\/)/.test(name)
      || /^(?:package(?:-lock)?\.json|Dockerfile|tsconfig[^/]*\.json|apps\/web\/(?:package\.json|tsconfig[^/]*\.json|next\.config\.[^/]+)|\.github\/workflows\/deploy-yandex\.yml)$/.test(name);
  });
}

export function assertHomeSourceEvidence(proof) {
  need(proof?.version === 1 && proof.clean === true && proof.reviewedFilterChangesOnly === true, 'source_evidence');
  for (const key of ['source','tree','retainedSource','retainedTree','sourceCalculationVersion',
    'servingCalculationVersion','codeDiffSha256','sourceClosureRecords']) need(proof[key] === HOME_UI[key], 'source_' + key);
  need(JSON.stringify(proof.codePaths) === JSON.stringify(HOME_UI.codePaths), 'source_paths');
  return proof;
}

export function verifyHomeSourceCheckout(root) {
  need(git(root, ['rev-parse','HEAD']).trim() === HOME_UI.source, 'source_head');
  need(git(root, ['rev-parse','HEAD^{tree}']).trim() === HOME_UI.tree, 'source_tree');
  need(!git(root, ['status','--porcelain=v1','--untracked-files=normal']).trim(), 'source_dirty');
  need(git(root, ['rev-parse',HOME_UI.retainedSource + '^{tree}']).trim() === HOME_UI.retainedTree, 'retained_tree');
  for (const ref of [HOME_UI.retainedSource, HOME_UI.source]) {
    need(git(root, ['rev-parse',ref + ':scripts/catalog-calculation-version.mjs']).trim() === HOME_UI.calculationAlgorithmBlob, 'calculation_algorithm');
  }
  const before = calculationRecords(root, HOME_UI.retainedSource), after = calculationRecords(root, HOME_UI.source);
  const byPath=records=>new Map(records.map(row=>{
    const [identity,name]=row.split('\t');return [name,identity];
  }));
  const retained=byPath(before),candidate=byPath(after);
  const changes=[...new Set([...retained.keys(),...candidate.keys()])].sort()
    .filter(name=>retained.get(name)!==candidate.get(name))
    .map(name=>[name,retained.get(name)??null,candidate.get(name)??null]);
  need(JSON.stringify(changes)===JSON.stringify(reviewedFilterBlobs),'calculation_closure_changed');
  need(after.length === HOME_UI.sourceClosureRecords, 'calculation_closure_count');
  const sourceCalculationVersion = sha256('avtocena-calculator-v1\0' + after.join('\0'));
  need(sourceCalculationVersion === HOME_UI.sourceCalculationVersion, 'calculation_version');
  const codePaths = git(root, ['diff','--name-only','--no-renames',HOME_UI.retainedSource,HOME_UI.source,'--',...codeRoots]).trim().split('\n');
  const diff = git(root, ['diff','--no-ext-diff','--no-renames','--no-textconv','--binary','--full-index',HOME_UI.retainedSource,HOME_UI.source,'--',...codeRoots]);
  return assertHomeSourceEvidence({version:1, clean:true, reviewedFilterChangesOnly:true, codePaths,
    source:HOME_UI.source, tree:HOME_UI.tree, retainedSource:HOME_UI.retainedSource, retainedTree:HOME_UI.retainedTree,
    sourceCalculationVersion, servingCalculationVersion:HOME_UI.servingCalculationVersion,
    codeDiffSha256:sha256(diff), sourceClosureRecords:after.length});
}

export function verifyHomeGateFiles(root) {
  for (const [name, digest] of Object.entries(GATE_FILES)) need(sha256(fs.readFileSync(path.join(root, name))) === digest, 'gate_changed:' + name);
  const baseline = JSON.parse(fs.readFileSync(path.join(root, 'docs/operations/2026-11-11-accepted-speed-baseline.json'), 'utf8'));
  const routes = [...new Set(baseline.samples.map(row => row.path))];
  need(baseline.schemaVersion === 1 && baseline.complete === true && routes.length === 17 && routes.includes('/'), 'baseline_routes');
  return {routes, baselineSha256:GATE_FILES['docs/operations/2026-11-11-accepted-speed-baseline.json']};
}

export function homeServerGateInvocation(root, base, env = process.env) {
  const {routes} = verifyHomeGateFiles(root), url = new URL(base);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port === '3003'
    && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password, 'candidate_gate_address');
  return {command:'python3', args:[path.join(root, 'scripts/regcloud-performance-gate.py'), url.origin, HOME_UI.source],
    env:{...env, AVTOCENA_RELEASE_MARKETS:'', AVTOCENA_SPEED_BASELINE_MODE:'enforce',
      AVTOCENA_SPEED_BASELINE:path.join(root, 'docs/operations/2026-11-11-accepted-speed-baseline.json')}, routes};
}

// This command verifies local files only. It cannot start, switch, bind or
// publish anything; the host adapter remains unavailable until inventory review.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    need(process.argv.length === 3, 'usage_source_checkout_required');
    console.log(JSON.stringify(verifyHomeSourceCheckout(process.argv[2])));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
