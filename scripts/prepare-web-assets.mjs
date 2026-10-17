import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import sharp from 'sharp';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'apps/web/package.json'));
const publicDir = path.join(root, 'apps/web/public');
const destination = path.join(publicDir, 'buyers/webp');
await fs.mkdir(destination, { recursive: true });
let originalBytes = 0, railBytes = 0, largeBytes = 0;
for (let n = 1; n <= 24; n++) {
  const source = path.join(publicDir, `buyers/${n}.jpg`);
  originalBytes += (await fs.stat(source)).size;
  for (const width of [256, 448, 1280]) {
    let quality = width === 1280 ? 72 : 50;
    let bytes;
    do {
      bytes = await sharp(source).rotate().resize({ width, height: width, fit: 'inside', withoutEnlargement: true }).webp({ quality, effort: 5 }).toBuffer();
      quality -= 5;
    } while (bytes.length > 300 * 1024 && quality >= 50);
    await fs.writeFile(path.join(destination, `${n}-${width}.webp`), bytes);
    if (width === 448) railBytes += bytes.length;
    if (width === 1280) largeBytes += bytes.length;
  }
}
const pdfRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
const { version } = JSON.parse(await fs.readFile(path.join(pdfRoot, 'package.json'), 'utf8'));
const workerDir = path.join(publicDir, 'pdfjs', version);
await fs.mkdir(workerDir, { recursive: true });
await fs.copyFile(path.join(pdfRoot, 'legacy/build/pdf.worker.min.mjs'), path.join(workerDir, 'pdf.worker.min.mjs'));
for (const dir of ['cmaps', 'standard_fonts', 'wasm']) await fs.cp(path.join(pdfRoot, dir), path.join(workerDir, dir), { recursive: true });
console.log(JSON.stringify({ originalBytes, railBytes, largeBytes, railReduction: +(originalBytes / railBytes).toFixed(1), pdfjs: version }));
