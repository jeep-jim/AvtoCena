import fs from 'node:fs/promises';
import path from 'node:path';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {archiveIntakeDirectory, verifyIntakeArchive, NONJP_INTAKE_MARKETS} from './lib/nonjp-intake-archive.mjs';

const [mode, market, input] = process.argv.slice(2);
if (!['archive','restore-for-publication','restore-receipt'].includes(mode) || !NONJP_INTAKE_MARKETS.includes(market) || !input) {
  throw Error('intake_archive_arguments');
}
const storage=getJsonStorage(), directory=path.resolve(input);
// A saved receipt is sufficient after the short-lived Actions artifact expires.
// This mode reads our immutable archive only; it does not create a new archive.
const receipt=mode==='restore-receipt' ? JSON.parse(await fs.readFile(directory,'utf8'))
  : await archiveIntakeDirectory({storage,directory,market});
if(receipt.market!==market)throw Error('intake_archive_receipt_market');
let restored;
if (mode!=='archive') {
  const parent=await fs.mkdtemp(path.join(process.env.RUNNER_TEMP || process.cwd(),'nonjp-intake-'));
  restored=path.join(parent,`catalog-intake-${market}`);
  await verifyIntakeArchive({storage,receipt,directory:restored});
  if (!process.env.GITHUB_ENV) throw Error('intake_archive_workflow_env_required');
  await fs.appendFile(process.env.GITHUB_ENV,`CATALOG_INTAKE_INPUT_DIR=${parent}\n`);
}
console.log(JSON.stringify({stage:'own_intake_archive_verified',market,root:receipt.root,
  manifestSha256:receipt.manifestSha256,restoredForPublication:Boolean(restored),supplierRequests:0}));
