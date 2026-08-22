import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(process.env.KNOWLEDGE_OUTPUT_ROOT || "data/catalog/knowledge-source-snapshots/generated");
const MLIT = path.join(ROOT, "mlit");
const manifest = JSON.parse(await fs.readFile(path.join(MLIT, "snapshot-manifest.json"), "utf8"));

const clean = (value) => String(value ?? "")
  .replace(/&nbsp;|&#160;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .normalize("NFKC")
  .replace(/\s+/g, " ")
  .trim();

function pageTitle(html) {
  const h1 = String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return clean(h1 || "") || clean(title || "");
}
function kindFor(url) {
  const pathname = new URL(url).pathname.toLowerCase();
  if (/\.(?:xls|xlsx|csv|zip)$/.test(pathname)) return "tabular_attachment";
  if (/\.pdf$/.test(pathname)) return "pdf_reference";
  return null;
}
function links(html, baseUrl) {
  const out = [];
  for (const match of String(html).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(match[1], baseUrl).toString();
      if (!/^https:\/\/(?:www\.)?mlit\.go\.jp\//i.test(url)) continue;
      const kind = kindFor(url);
      if (!kind) continue;
      out.push({ url, text: clean(match[2]), kind });
    } catch {}
  }
  return out;
}

const pages = (manifest.files || []).filter((item) => item?.file?.startsWith("mlit/pages/") && item?.sourceUrl);
const attachmentMap = new Map();
for (const page of pages) {
  const local = path.join(ROOT, page.file);
  let html = "";
  try { html = await fs.readFile(local, "utf8"); } catch { continue; }
  const sourcePageTitle = pageTitle(html);
  for (const link of links(html, page.sourceUrl)) {
    const current = attachmentMap.get(link.url);
    const row = {
      ...link,
      sourcePageUrl: page.sourceUrl,
      sourcePageTitle: sourcePageTitle || null,
    };
    if (!current || (!current.sourcePageTitle && row.sourcePageTitle)) attachmentMap.set(link.url, row);
  }
}
const enriched = [...attachmentMap.values()].sort((a, b) => a.url.localeCompare(b.url, "en"));
await fs.writeFile(path.join(MLIT, "discovered-attachments.json"), `${JSON.stringify(enriched, null, 2)}\n`);
const report = {
  schemaVersion: 1,
  builtAt: new Date().toISOString(),
  pagesScanned: pages.length,
  attachments: enriched.length,
  tabular: enriched.filter((x) => x.kind === "tabular_attachment").length,
  pdf: enriched.filter((x) => x.kind === "pdf_reference").length,
  withSourcePageTitle: enriched.filter((x) => x.sourcePageTitle).length,
};
await fs.writeFile(path.join(MLIT, "attachment-context-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!enriched.length) throw new Error("mlit_attachment_context_zero");
