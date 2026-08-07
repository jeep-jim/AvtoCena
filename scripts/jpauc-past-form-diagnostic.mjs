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
  return [...new Set(values)].filter((url) => !/loading\.gif|logo|favicon|icon|banner|sprite/i.test(url));
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
const firstRow = listingHtml.match(/<tr\b([^>]*)data-id=["'](\d+)["']([^>]*)>[\s\S]*?<\/tr>/i);
if (!firstRow) throw new Error("jpauc_listing_row_missing");
const rowOpenAttrs = `${firstRow[1]} data-id="${firstRow[2]}" ${firstRow[3]}`;
const dataId = firstRow[2];
const rowHtml = firstRow[0];
const rowText = clean(rowHtml.replace(/<[^>]+>/g, " "));
const r = rowOpenAttrs.match(/data-r=["']([^"']+)["']/i)?.[1] || "1";
const rtotal = rowOpenAttrs.match(/data-r-total=["']([^"']+)["']/i)?.[1] || String((listingHtml.match(/<tr\b[^>]*data-id=/gi) || []).length || 1);
const listingImages = parseImages(rowHtml, currentUrl);

const detailUrl = `https://jpauc.com/auction/past/detail/${encodeURIComponent(dataId)}?&ys=1900&ye=2100&mm=0&mx=9999&p=1&ob=none&r=0&r=${encodeURIComponent(r)}&rtotal=${encodeURIComponent(rtotal)}`;
const detailResponse = await request(detailUrl, cookie, { headers: { referer: currentUrl } });
const detailText = clean(detailResponse.html
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " "));
const detailImages = parseImages(detailResponse.html, detailResponse.response.url);

const priceFragments = [...detailText.matchAll(/(?:End\s*Price|Sold\s*Price|Result|Price|Start)[^¥￥0-9]{0,30}[¥￥]?\s*([0-9][0-9,]*)/gi)]
  .map((match) => ({ label: clean(match[0].replace(match[1], "")), value: match[1] }))
  .slice(0, 30);

const output = {
  checkedAt: new Date().toISOString(),
  cookiePresent: Boolean(cookie),
  selectedDate,
  stages,
  listing: {
    url: currentUrl,
    dataId,
    r,
    rtotal,
    rowText,
    images: listingImages,
  },
  detail: {
    requestedUrl: detailUrl,
    finalUrl: detailResponse.response.url,
    status: detailResponse.response.status,
    bytes: detailResponse.html.length,
    text: detailText.slice(0, 30000),
    priceFragments,
    images: detailImages.slice(0, 60),
  },
};

await fs.writeFile("jpauc-past-form-diagnostic.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
if (!detailResponse.response.ok || detailText.length < 500 || detailImages.length < 1) process.exit(1);
