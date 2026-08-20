import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) {
  throw new Error("Usage: node scripts/prepare-brand-logo-supplement.mjs <source-root> <output-root>");
}

const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
const lightInk = { r: 17, g: 24, b: 39, alpha: 1 };
const darkInk = { r: 255, g: 255, b: 255, alpha: 1 };

async function source(name) {
  return fs.readFile(path.join(sourceRoot, name));
}

async function contain(input) {
  return sharp(input, { density: 600 })
    .trim({ background: transparent })
    .resize(180, 90, { fit: "contain", background: transparent })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function extractContain(input, extract) {
  return sharp(input)
    .extract(extract)
    .trim({ background: transparent })
    .resize(180, 90, { fit: "contain", background: transparent })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function silhouette(input, color) {
  const mask = await contain(input);
  return sharp({ create: { width: 180, height: 90, channels: 4, background: color } })
    .composite([{ input: mask, blend: "dest-in" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function write(slug, light, dark = light) {
  await Promise.all([
    fs.writeFile(path.join(outputRoot, "light", `${slug}.png`), light),
    fs.writeFile(path.join(outputRoot, "dark", `${slug}.png`), dark),
  ]);
}

await Promise.all([
  fs.mkdir(path.join(outputRoot, "light"), { recursive: true }),
  fs.mkdir(path.join(outputRoot, "dark"), { recursive: true }),
]);

for (const [slug, file] of [
  ["corvette", "corvette.png"],
  ["dfsk", "dfsk.png"],
  ["ds", "ds.png"],
  ["microcar", "microcar.png"],
]) {
  await write(slug, await contain(await source(file)));
}

for (const [slug, file] of [
  ["aion", "aion.png"],
  ["brp", "brp-white.svg"],
  ["evo", "evo.png"],
  ["ich-x", "ich-x.svg"],
  ["luxeed", "luxeed.png"],
  ["stelato", "stelato.png"],
]) {
  const input = await source(file);
  await write(slug, await silhouette(input, lightInk), await silhouette(input, darkInk));
}

const dr = await source("dr.svg");
await write("dr", await contain(dr), await contain(Buffer.from(dr.toString().replaceAll("#000028", "#FFFFFF"))));

const aixam = await source("aixam.svg");
await write(
  "aixam",
  await contain(Buffer.from(aixam.toString().replace('style="fill:#fff"', 'style="fill:#001332"'))),
  await contain(aixam),
);

const canAm = await source("can-am.svg");
await write(
  "can-am",
  await contain(canAm),
  await contain(Buffer.from(canAm.toString().replace(
    '<g id="CA_logo_K_with_silent_area">',
    '<g id="CA_logo_K_with_silent_area" fill="#FFFFFF">',
  ))),
);

await write("emc", await contain(await source("emc-black.svg")), await contain(await source("emc-white.svg")));
await write("ligier", await contain(await source("ligier-white.svg")), await contain(await source("ligier-dark.svg")));

const kubotaWordmark = await extractContain(await source("kubota.svg"), { left: 110, top: 23, width: 80, height: 19 });
await write("kubota", kubotaWordmark);
