import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const MARKETS = Object.freeze(['china', 'japan', 'korea', 'uae', 'europe', 'georgia', 'green']);
export const KNOWN_LEGACY_CHINA = Object.freeze([
  'catalog-refresh-china.yml',
  'catalog-prepare-owned-china.yml',
  'stage-owned-china-generation.yml',
  'accept-owned-china-generation.yml',
  'catalog-che168-verify-publication.yml',
  'catalog-v2-china.yml',
]);
const TRIGGERS = new Set(['schedule', 'workflow_dispatch', 'workflow_run', 'workflow_call', 'push', 'pull_request', 'repository_dispatch']);
const ENTRY_SIGNS = Object.freeze([
  ['shared-publisher', /catalog-market-refresh\.yml|catalog-publish-market\.mjs|catalog-publish-current-read-models\.mjs/],
  ['fixed-old-china-publisher', /bb6317bffd1f7b1832681ac78378fe6c3e39e3b5|recover_existing_intake/],
  ['next-market-activation', /catalog-next\/(?:release|daily-release)\.mjs|catalog-activate-staged-publication\.mjs/],
  ['china-generation-activation', /accept-owned-china-generation|stage-owned-china-generation|catalog-next-china-release/],
  ['deploy-or-publish', /regcloud-deploy|catalog-publish|catalog-live-recovery-publish/],
]);
const marketTokens = Object.freeze({
  china: /\bchina\b|che168|китай/i, japan: /\bjapan\b|ajes|aj-system|япони/i,
  korea: /\bkorea\b|encar|коре/i, uae: /\buae\b|dubicars|оаэ/i,
  europe: /\beurope\b|mobile\.de|европ/i, georgia: /\bgeorgia\b|myauto|autopapa|грузи/i,
  green: /\bgreen\b|akebono|зел[её]н/i,
});

export function workflowTriggers(source) {
  const lines = source.split(/\r?\n/), start = lines.findIndex(line => /^on:\s*(?:#.*)?$/.test(line));
  if (start < 0) return [];
  const triggers = new Set();
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^[^\s#-][^:]*:/.test(line)) break;
    const match = /^  ([a-z_]+):\s*(?:#.*)?$/.exec(line);
    if (match && TRIGGERS.has(match[1])) triggers.add(match[1]);
  }
  return [...triggers].sort();
}

export function inspectWorkflow(filename, source) {
  const tokens = filename.replace(/\.ya?ml$/, '') + '\n' + source;
  const marketHints = MARKETS.filter(market => marketTokens[market].test(tokens));
  const signals = ENTRY_SIGNS.filter(([, rx]) => rx.test(source)).map(([name]) => name);
  const filenameCandidate = /publish|deploy|refresh|recover|accept|stage|activate|daily|release|commit|rebuild|retention|collection|collect/i.test(filename);
  return {
    workflow: '.github/workflows/' + filename,
    triggers: workflowTriggers(source),
    marketHints,
    signals,
    knownLegacyChina: KNOWN_LEGACY_CHINA.includes(filename),
    reviewCandidate: filenameCandidate || signals.length > 0,
  };
}

/** Read-only source audit. It cannot establish whether GitHub Actions, cron,
 * an external runner or a host timer is enabled, and it does not change them. */
export async function collectWorkflowInventory(root = ROOT) {
  const directory = path.join(root, '.github', 'workflows');
  const files = (await fs.readdir(directory)).filter(name => /\.ya?ml$/.test(name)).sort();
  const entries = await Promise.all(files.map(async filename =>
    inspectWorkflow(filename, await fs.readFile(path.join(directory, filename), 'utf8'))));
  const present = new Set(files);
  return {
    version: 1,
    kind: 'market-writer-source-inventory',
    authority: 'read-only source evidence; not proof that a workflow is currently enabled or writes data',
    scannedWorkflowCount: entries.length,
    knownLegacyChina: KNOWN_LEGACY_CHINA.map(filename => ({
      workflow: '.github/workflows/' + filename, presentInMain: present.has(filename),
    })),
    candidates: entries.filter(entry => entry.reviewCandidate),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw Error('inventory_arguments');
    const result = await collectWorkflowInventory();
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    process.stderr.write('market_writer_inventory_failed: ' + (error?.code || 'invalid_source') + '\n');
    process.exitCode = 1;
  }
}
