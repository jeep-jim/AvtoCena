import crypto from "node:crypto";
import sharp from "sharp";
import { getJsonStorage, StorageConflictError } from "../apps/web/lib/data.ts";
import { loadWorkspace } from "./vehicle-encyclopedia/lib.mjs";
import { compileAutocatalogLetters } from "./autocatalog-publication-lib.mjs";

const STORAGE_ROOT = "catalog/autocatalog/v1";
const MANIFEST_PATH = `${STORAGE_ROOT}/manifest.json`;
const USER_AGENT = "AvtoCena-Autocatalog/1.0 (+https://avtocena.com)";
const MAX_MEDIA_DOWNLOADS = positiveInteger(process.env.AUTOCATALOG_MAX_MEDIA_DOWNLOADS, 60, 1, 60);
const DOWNLOAD_DELAY_MS = positiveInteger(process.env.AUTOCATALOG_DOWNLOAD_DELAY_MS, 1_250, 1_000, 10_000);
const MAX_SOURCE_BYTES = positiveInteger(process.env.AUTOCATALOG_MAX_SOURCE_BYTES, 8 * 1024 * 1024, 1_000_000, 12 * 1024 * 1024);
const MAX_TOTAL_SOURCE_BYTES = positiveInteger(process.env.AUTOCATALOG_MAX_TOTAL_SOURCE_BYTES, 250 * 1024 * 1024, 10_000_000, 300 * 1024 * 1024);
const MAX_OUTPUT_BYTES = positiveInteger(process.env.AUTOCATALOG_MAX_OUTPUT_BYTES, 25 * 1024 * 1024, 2_000_000, 50 * 1024 * 1024);
const MAX_STORAGE_WRITES = positiveInteger(process.env.AUTOCATALOG_MAX_STORAGE_WRITES, 120, 1, 120);
const dryRun = process.argv.includes("--dry-run");
const skipMedia = process.argv.includes("--skip-media");

function positiveInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function modelNames(models) {
  return new Map(models.map((row) => [row.id, row.canonicalName]));
}

function sourceNames(sources) {
  return new Map(sources.map((row) => [row.id, row]));
}

function downloadableWikimediaUrl(value) {
  const url = new URL(value);
  if (url.hostname.toLowerCase() === "commons.wikimedia.org" && url.pathname.includes("/wiki/Special:Redirect/file/")) {
    url.searchParams.set("width", "1600");
  }
  return url.toString();
}

async function downloadSourceImage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let response;
  try {
    response = await fetch(downloadableWikimediaUrl(url), {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "image/avif,image/webp,image/jpeg,image/png" },
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`media_http_${response.status}`);
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("image/")) throw new Error("media_content_type_invalid");
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > MAX_SOURCE_BYTES) throw new Error("media_source_too_large");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_SOURCE_BYTES) throw new Error("media_source_too_large");
  return bytes;
}

async function optimizeCover(source) {
  const metadata = await sharp(source, { failOn: "warning", limitInputPixels: 45_000_000 }).metadata();
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  if (width < 800 || height < 450) throw new Error(`media_dimensions_too_small:${width}x${height}`);

  for (const plan of [
    { width: 1_280, height: 720, quality: 82 },
    { width: 1_280, height: 720, quality: 72 },
    { width: 1_024, height: 640, quality: 68 },
    { width: 960, height: 600, quality: 60 },
  ]) {
    const output = await sharp(source, { failOn: "warning", limitInputPixels: 45_000_000 })
      .rotate()
      .resize({ width: plan.width, height: plan.height, fit: "inside", withoutEnlargement: true })
      .webp({ quality: plan.quality, effort: 5 })
      .toBuffer();
    if (output.length <= 350 * 1024) {
      const result = await sharp(output).metadata();
      return { output, width: result.width, height: result.height };
    }
  }
  throw new Error("media_output_too_large");
}

async function main() {
  const { records } = await loadWorkspace();
  const compiled = compileAutocatalogLetters({
    brands: records.brand,
    models: records.model,
    generations: records.generation,
    facelifts: records.facelift,
    variants: records.variant,
    sources: records.source,
    media: records.media,
  });
  const storage = getJsonStorage();
  if (!dryRun && storage.driver !== "object") throw new Error("autocatalog_publish_requires_object_storage");
  const previous = await storage.readJson(MANIFEST_PATH, { schemaVersion: 1, letters: [], covers: [] });
  const previousLetters = new Map((previous.letters || []).map((row) => [row.letter, row]));
  const previousCovers = new Map((previous.covers || []).map((row) => [row.modelId, row]));
  const namesByModel = modelNames(records.model);
  const sourcesById = sourceNames(records.source);
  const report = {
    dryRun,
    compiled: compiled.counts,
    jsonWrites: 0,
    jsonSkips: 0,
    mediaDownloads: 0,
    mediaWrites: 0,
    mediaReused: 0,
    mediaRejected: [],
    sourceBytes: 0,
    outputBytes: 0,
  };
  const assertWriteBudget = () => {
    if (report.jsonWrites + report.mediaWrites >= MAX_STORAGE_WRITES) throw new Error("autocatalog_storage_write_limit");
  };

  const publishedCovers = [];
  for (const cover of skipMedia ? [] : compiled.covers) {
    const reused = previousCovers.get(cover.modelId);
    if (reused?.originalUrl === cover.originalUrl && reused?.license === cover.license && reused?.objectKey) {
      publishedCovers.push(reused);
      report.mediaReused += 1;
      continue;
    }
    if (report.mediaDownloads >= MAX_MEDIA_DOWNLOADS) break;
    if (report.mediaDownloads) await sleep(DOWNLOAD_DELAY_MS);
    report.mediaDownloads += 1;
    try {
      const source = await downloadSourceImage(cover.originalUrl);
      report.sourceBytes += source.length;
      if (report.sourceBytes > MAX_TOTAL_SOURCE_BYTES) throw new Error("autocatalog_total_source_byte_limit");
      const optimized = await optimizeCover(source);
      report.outputBytes += optimized.output.length;
      if (report.outputBytes > MAX_OUTPUT_BYTES) throw new Error("autocatalog_output_byte_limit");
      const checksum = sha256(optimized.output);
      const objectKey = `${STORAGE_ROOT}/media/model-covers/${checksum}.webp`;
      assertWriteBudget();
      if (!dryRun && storage.putBinary) {
        try {
          await storage.putBinary(objectKey, optimized.output, "image/webp", { ifNoneMatch: "*" });
        } catch (error) {
          if (!(error instanceof StorageConflictError)) throw error;
        }
      }
      report.mediaWrites += 1;
      publishedCovers.push({
        ...cover,
        modelName: namesByModel.get(cover.modelId),
        source: sourcesById.get(cover.sourceId)?.url || cover.pageUrl,
        objectKey,
        mimeType: "image/webp",
        width: optimized.width,
        height: optimized.height,
        size: optimized.output.length,
        sha256: checksum,
      });
    } catch (error) {
      report.mediaRejected.push({ modelId: cover.modelId, reason: error instanceof Error ? error.message : "media_failed" });
    }
  }

  const coverById = new Map(publishedCovers.map((row) => [row.id, row]));
  const letterManifest = [];
  for (const letter of compiled.letters) {
    const payload = {
      schemaVersion: 1,
      letter: letter.letter,
      generatedAt: new Date().toISOString(),
      brands: letter.brands,
      sources: letter.sources,
      covers: letter.brands.flatMap((brand) => brand.models.map((model) => coverById.get(model.coverId)).filter(Boolean)),
    };
    const objectKey = `${STORAGE_ROOT}/letters/${letter.letter === "#" ? "other" : letter.letter.toLowerCase()}.json`;
    const checksum = sha256(stableJson({ ...payload, generatedAt: undefined }));
    const descriptor = { letter: letter.letter, objectKey, sha256: checksum, brands: payload.brands.length };
    letterManifest.push(descriptor);
    if (previousLetters.get(letter.letter)?.sha256 === checksum) {
      report.jsonSkips += 1;
      continue;
    }
    assertWriteBudget();
    if (!dryRun) await storage.writeJson(objectKey, payload);
    report.jsonWrites += 1;
  }

  const manifest = {
    schemaVersion: 1,
    name: "Автокаталог",
    generatedAt: new Date().toISOString(),
    sourcePolicy: "field-level provenance; licensed or official media only; no third-party catalog mirroring",
    counts: { ...compiled.counts, publishedCovers: publishedCovers.length },
    limits: {
      maxMediaDownloads: MAX_MEDIA_DOWNLOADS,
      downloadDelayMs: DOWNLOAD_DELAY_MS,
      maxSourceBytes: MAX_SOURCE_BYTES,
      maxTotalSourceBytes: MAX_TOTAL_SOURCE_BYTES,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      maxStorageWrites: MAX_STORAGE_WRITES,
    },
    letters: letterManifest,
    covers: publishedCovers,
  };
  assertWriteBudget();
  if (!dryRun) await storage.writeJson(MANIFEST_PATH, manifest);
  report.jsonWrites += 1;
  console.log(JSON.stringify({ ok: true, manifest: MANIFEST_PATH, report }, null, 2));
}

await main();
