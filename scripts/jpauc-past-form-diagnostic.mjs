import fs from "node:fs/promises";

const baseHeaders = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ja;q=0.8",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};
const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();

function parseInputs(html) {
  return [...html.matchAll(/<(input|button)\b([^>]*)>/gi)].map((match) => {
    const attrs = {};
    for (const attr of match[2].matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? attr[4] ?? true;
    return { tag: match[1].toLowerCase(), ...attrs };
  });
}

async function request(url, cookie, options = {}) {
  const response = await fetch(url, {
    headers: { ...baseHeaders, ...(cookie ? { cookie } : {}), ...(options.headers || {}) },
    method: options.method || "GET",
    body: options.body,
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  return { response, html: await response.text() };
}

function parseImages(html, baseUrl) {
  const values = [];
  for (const match of html.matchAll(/(?:data-original|data-src|data-lazy-src|src|href)=["']([^"']+)["']/gi)) {
    const raw = String(match[1] || "").replace(/&amp;/g, "&");
    if (!/pic\/\?|\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(raw)) continue;
    try { values.push(new URL(raw, baseUrl).toString()); } catch {}
  }
  return [...new Set(values)].filter((url) => !/loading\.gif|jpauc\.png|logo|favicon|icon|banner|sprite/i.test(url));
}

function rowsFromListing(html) {
  return [...html.matchAll(/<tr\b([^>]*)data-id=["'](\d+)["']([^>]*)>[\s\S]*?<\/tr>/gi)].map((match) => {
    const attrs = `${match[1]} data-id="${match[2]}" ${match[3]}`;
    const rowHtml = match[0];
    return {
      dataId: match[2],
      r: attrs.match(/data-r=["']([^"']+)["']/i)?.[1] || "1",
      rtotal: attrs.match(/data-r-total=["']([^"']+)["']/i)?.[1] || "1",
      rowHtml,
      rowText: clean(rowHtml.replace(/<[^>]+>/g, " ")),
      images: parseImages(rowHtml, "https://jpauc.com/auction/past/listing-2"),
    };
  });
}

function endPrice(text) {
  const value = text.match(/End\s*Price\s*:\s*[¥￥]?\s*([0-9][0-9,]*)/i)?.[1];
  if (!value) return 0;
  const amount = Number(value.replace(/,/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

const initial = await request("https://jpauc.com/auction/past", "", { headers: { referer: "https://jpauc.com/auction" } });
const cookie = String(initial.response.headers.get("set-cookie") || "").split(";")[0];
const dates = [...initial.html.matchAll(/name=["']checkdate\[\]["'][^>]*value=["']([^"']+)["']/gi)].map((m) => m[1]);
const selectedDate = dates[0];
if (!selectedDate) throw new Error("jpauc_no_past_date");

let currentUrl = "https://jpauc.com/auction/past";
let body = new URLSearchParams([["checkdate[]", selectedDate], ["submit", "submitauction"]]);
let listingHtml = "";
const stages = [];

for (let step = 0; step < 4; step++) {
  const posted = await request(currentUrl, cookie, {
    method: "POST",
    body: body.toString(),
    headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://jpauc.com", referer: currentUrl },
  });
  currentUrl = posted.response.url;
  stages.push({ url: currentUrl, status: posted.response.status, bytes: posted.html.length, requestBody: body.toString() });
  if (/\/listing/i.test(currentUrl)) { listingHtml = posted.html; break; }
  const inputs = parseInputs(posted.html);
  let chosen = null;
  if (/\/maker(?:$|[?#])/i.test(currentUrl)) chosen = inputs.find((input) => input.type === "checkbox" && input.name === "mk[]" && String(input.value) === "9");
  else if (/\/model(?:$|[?#])/i.test(currentUrl)) chosen = inputs.find((input) => input.type === "checkbox" && input.name === "md[]");
  if (!chosen) throw new Error(`jpauc_chain_stopped:${currentUrl}`);
  body = new URLSearchParams([[String(chosen.name), String(chosen.value)]]);
}

if (!listingHtml) throw new Error("jpauc_listing_missing");
const rows = rowsFromListing(listingHtml);
const probes = [];
let selected = null;

for (const row of rows.slice(0, 28)) {
  const detailUrl = `https://jpauc.com/auction/past/detail/${encodeURIComponent(row.dataId)}?&ys=1900&ye=2100&mm=0&mx=9999&p=1&ob=none&r=0&r=${encodeURIComponent(row.r)}&rtotal=${encodeURIComponent(row.rtotal)}`;
  const detailResponse = await request(detailUrl, cookie, { headers: { referer: currentUrl } });
  const detailText = clean(detailResponse.html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "));
  const amount = endPrice(detailText);
  const images = parseImages(detailResponse.html, detailResponse.response.url);
  probes.push({ dataId: row.dataId, rowText: row.rowText, status: detailResponse.response.status, endPrice: amount, imageCount: images.length });
  if (amount > 0 && images.length >= 1) {
    selected = {
      ...row,
      detailUrl,
      detailText,
      endPrice: amount,
      images,
      status: detailResponse.response.status,
      bytes: detailResponse.html.length,
    };
    break;
  }
}

const output = {
  checkedAt: new Date().toISOString(),
  cookiePresent: Boolean(cookie),
  selectedDate,
  stages,
  listing: { url: currentUrl, rowCount: rows.length },
  probes,
  selected: selected ? {
    dataId: selected.dataId,
    r: selected.r,
    rtotal: selected.rtotal,
    rowText: selected.rowText,
    detailUrl: selected.detailUrl,
    status: selected.status,
    bytes: selected.bytes,
    endPrice: selected.endPrice,
    text: selected.detailText.slice(0, 30000),
    images: selected.images.slice(0, 30),
  } : null,
};

await fs.writeFile("jpauc-past-form-diagnostic.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
if (!selected) process.exit(1);
