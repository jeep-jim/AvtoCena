import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/catalog-cli.ts', ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
