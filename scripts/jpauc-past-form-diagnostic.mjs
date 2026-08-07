import fs from "node:fs/promises";

const headers = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ja;q=0.8",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
};
const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();

async function request(url, cookie = "", options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    body: options.body,
    redirect: "follow",
    headers: { ...headers, ...(cookie ? { cookie } : {}), ...(options.headers || {}) },
    signal: AbortSignal.timeout(30000),
  });
  return { response, html: await response.text() };
}

function checkboxValues(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...html.matchAll(new RegExp(`name=["']${escaped}["'][^>]*value=["']([^"']+)["']`, "gi"))].map((m) => m[1]);
}

function listingRows(html) {
  return [...html.matchAll(/<tr\b[^>]*data-id=["'](\d+)["'][^>]*>[\s\S]*?<\/tr>/gi)].map((m) => ({
    id: m[1],
    text: clean(m[0].replace(/<[^>]+>/g, " ")),
  }));
}

const initial = await request("https://jpauc.com/auction/past");
const cookie = String(initial.response.headers.get("set-cookie") || "").split(";")[0];
const dates = checkboxValues(initial.html, "checkdate[]");
const selectedDate = dates[0];
if (!selectedDate) throw new Error("jpauc_no_date");

const maker = await request("https://jpauc.com/auction/past", cookie, {
  method: "POST",
  body: new URLSearchParams([["checkdate[]", selectedDate], ["submit", "submitauction"]]).toString(),
  headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://jpauc.com", referer: "https://jpauc.com/auction/past" },
});
const makers = checkboxValues(maker.html, "mk[]");
if (!makers.length) throw new Error("jpauc_no_makers");
const makerBody = new URLSearchParams();
makers.forEach((value) => makerBody.append("mk[]", value));
const model = await request(maker.response.url, cookie, {
  method: "POST",
  body: makerBody.toString(),
  headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://jpauc.com", referer: maker.response.url },
});
const models = checkboxValues(model.html, "md[]");
if (!models.length) throw new Error("jpauc_no_models");
const modelBody = new URLSearchParams();
models.forEach((value) => modelBody.append("md[]", value));
const listing = await request(model.response.url, cookie, {
  method: "POST",
  body: modelBody.toString(),
  headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://jpauc.com", referer: model.response.url },
});
const rows = listingRows(listing.html);
const total = Number(listing.html.match(/\d+\s*-\s*\d+\s+of\s+([0-9,]+)/i)?.[1]?.replace(/,/g, "") || 0);
const pageLinks = [...new Set([...listing.html.matchAll(/javascript:go\((\d+)\)/gi)].map((m) => Number(m[1])))]
  .filter(Number.isFinite)
  .sort((a, b) => a - b);

const output = {
  checkedAt: new Date().toISOString(),
  cookiePresent: Boolean(cookie),
  selectedDate,
  makerCount: makers.length,
  modelCount: models.length,
  makerUrl: maker.response.url,
  modelUrl: model.response.url,
  listingUrl: listing.response.url,
  listingStatus: listing.response.status,
  listingBytes: listing.html.length,
  rowCount: rows.length,
  total,
  pageLinks,
  sampleRows: rows.slice(0, 10),
};
await fs.writeFile("jpauc-past-form-diagnostic.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
if (!listing.response.ok || rows.length < 1 || total < rows.length) process.exit(1);
