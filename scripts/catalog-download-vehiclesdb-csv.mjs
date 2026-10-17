import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(process.env.KNOWLEDGE_OUTPUT_ROOT || "data/catalog/knowledge-source-snapshots/generated");
const outDir = path.join(ROOT, "vehiclesdb");
const url = "https://raw.githubusercontent.com/vehiclesdb/vehiclesdb/main/dist/vehicles.csv";
const maxBytes = Math.max(5_000_000, Math.min(100_000_000, Number(process.env.KNOWLEDGE_VEHICLESDB_MAX_BYTES || 50_000_000)));
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 120_000);
try {
  const response = await fetch(url, {
    signal: controller.signal,
    redirect: "follow",
    headers: {
      accept: "text/csv,text/plain,*/*",
      "user-agent": "AvtoCena-KnowledgeCORE/1.0 (+https://avtocena.com; public-data snapshot)",
    },
  });
  if (!response.ok) throw new Error(`vehiclesdb_csv_http_${response.status}`);
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxBytes) throw new Error(`vehiclesdb_csv_too_large:${contentLength}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error(`vehiclesdb_csv_too_large:${bytes.length}`);
  await fs.mkdir(outDir, { recursive: true });
  const file = path.join(outDir, "vehicles.csv");
  await fs.writeFile(file, bytes);
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  console.log(JSON.stringify({ source: "vehiclesdb", url, file, bytes: bytes.length, sha256: digest }, null, 2));
} finally {
  clearTimeout(timer);
}
