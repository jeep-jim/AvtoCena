import { spawnSync } from 'node:child_process';
const input = process.argv[2];
const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/catalog-cli.ts', 'catalog:import', input || ''], { stdio: 'inherit' });
process.exit(result.status ?? 1);
