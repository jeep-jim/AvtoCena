import fs from 'node:fs/promises';
import { runProbe } from './catalog-source-chngoodcar-access-policy-probe-v1.mjs';

// The source ID and origin are fixed by the existing registry, not supplied by an external page.
const registry = JSON.parse(await fs.readFile('data/catalog/source-qualification-v1.json', 'utf8'));
const result = await runProbe({ registry, candidateKey: 'iautos_china_candidate', origin: 'https://m.iautos.cn' });
await fs.writeFile('catalog-source-iautos-access-policy-probe-v1.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
