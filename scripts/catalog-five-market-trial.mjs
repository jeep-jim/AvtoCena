import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { REQUIRED_CATALOG_SOURCES } from '../apps/web/lib/catalog/required-catalog-sources.ts';

const market = process.env.TRIAL_MARKET;
if (!['korea', 'china', 'uae', 'europe', 'georgia'].includes(market)) throw new Error('trial_market_forbidden');
const root = path.resolve('five-market-trial', market);
await fs.mkdir(root, { recursive: true });
const sources = [];
for (const source of REQUIRED_CATALOG_SOURCES[market]) {
  const directory = path.join(root, source.sourceId);
  await fs.mkdir(directory, { recursive: true });
  const report = path.join(directory, 'report.json');
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/catalog-five-market-restart-check.mjs'], {
      stdio: 'inherit', env: { ...process.env, PILOT_TRIAL_PROFILE: 'five_market_v1', PILOT_ALLOW_EXISTING_BRIDGE: '1',
        PILOT_MARKETS: market, PILOT_REGISTERED_SOURCE_ID: source.sourceId, PILOT_SAMPLE_LIMIT: '200',
        PILOT_PAGE_LIMIT: '5', PILOT_REQUEST_LIMIT: '350', PILOT_TIMEOUT_MS: '45000', PILOT_REQUEST_INTERVAL_MS: '1000',
        PILOT_RESPONSE_EVIDENCE: '1', PILOT_REPORT: report, PILOT_SNAPSHOT_DIR: directory } });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(signal ? 1 : code ?? 1));
  });
  const outcome = await fs.readFile(report, 'utf8').then(JSON.parse).catch(() => null);
  sources.push({ sourceId: source.sourceId, exitCode, report: `${source.sourceId}/report.json`,
    verifiedComplete: outcome?.completed === true && outcome?.productionInputsUnchanged === true && !outcome.configurationMismatches?.length });
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({ version: 1, market, codeSha: process.env.GITHUB_SHA,
    productionWrites: false, japanIncluded: false, sources }, null, 2) + '\n');
}
if (sources.some(row => row.exitCode || !row.verifiedComplete)) process.exitCode = 1;
