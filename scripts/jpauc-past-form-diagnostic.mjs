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

function summarize(html, url) {
  const inputs = parseInputs(html);
  const hrefs = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  const detailLinks = [...new Set(hrefs.filter((href) => /\/auction\/detail\//i.test(href)))];
  const labels = [...html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/gi)].map((m) => clean(m[1].replace(/<[^>]+>/g, " "))).filter(Boolean);
  return { url, bytes: html.length, detailLinks: detailLinks.slice(0, 30), submitControls: inputs.filter((input) => input.name === "submit" || input.type === "submit").slice(0, 20), checkboxControls: inputs.filter((input) => input.type === "checkbox").slice(0, 80), labels: labels.slice(0, 120) };
}

async function request(url, cookie, options = {}) {
  const response = await fetch(url, { headers: { ...baseHeaders, ...(cookie ? { cookie } : {}), ...(options.headers || {}) }, method: options.method || "GET", body: options.body, redirect: "follow", signal: AbortSignal.timeout(30000) });
  return { response, html: await response.text() };
}

const initial = await request("https://jpauc.com/auction/past", "", { headers: { referer: "https://jpauc.com/auction" } });
const cookie = String(initial.response.headers.get("set-cookie") || "").split(";")[0];
const dates = [...initial.html.matchAll(/name=["']checkdate\[\]["'][^>]*value=["']([^"']+)["']/gi)].map((m) => m[1]);
const selectedDate = dates[0];
if (!selectedDate) throw new Error("jpauc_no_past_date");

const stages = [summarize(initial.html, initial.response.url)];
let currentUrl = "https://jpauc.com/auction/past";
let body = new URLSearchParams([["checkdate[]", selectedDate], ["submit", "submitauction"]]);
let listingHtml = "";

for (let step = 0; step < 4; step++) {
  const posted = await request(currentUrl, cookie, { method: "POST", body: body.toString(), headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://jpauc.com", referer: currentUrl } });
  currentUrl = posted.response.url;
  const summary = summarize(posted.html, currentUrl);
  summary.requestBody = body.toString();
  summary.status = posted.response.status;
  stages.push(summary);
  if (/\/listing/i.test(currentUrl)) { listingHtml = posted.html; break; }

  const inputs = parseInputs(posted.html);
  let chosen = null;
  if (/\/maker(?:$|[?#])/i.test(currentUrl)) chosen = inputs.find((input) => input.type === "checkbox" && input.name === "mk[]" && String(input.value) === "9");
  else if (/\/model(?:$|[?#])/i.test(currentUrl)) chosen = inputs.find((input) => input.type === "checkbox" && input.name === "md[]");
  if (!chosen) break;
  body = new URLSearchParams([[String(chosen.name), String(chosen.value)]]);
}

const firstRow = listingHtml.match(/<tr\b[^>]*data-id=["'](\d+)["'][^>]*>[\s\S]*?<\/tr>/i);
const dataId = firstRow?.[1] || "";
const rowHtml = firstRow?.[0] || "";
const rowText = clean(rowHtml.replace(/<[^>]+>/g, " "));
const rowImages = [...rowHtml.matchAll(/(?:data-original|src)=["']([^"']+)["']/gi)].map((m) => new URL(m[1], "https://jpauc.com").toString());
let detail = null;
if (dataId) {
  const detailUrl = `https://jpauc.com/auction/detail/${dataId}`;
  const detailResponse = await request(detailUrl, cookie, { headers: { referer: currentUrl } });
  const imageUrls = [...new Set([...detailResponse.html.matchAll(/(?:data-original|data-src|src|href)=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/gi)].map((m) => {
    try { return new URL(m[1].replace(/&amp;/g, "&"), detailResponse.response.url).toString(); } catch { return ""; }
  }).filter(Boolean))];
  const text = clean(detailResponse.html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
  detail = { requestedUrl: detailUrl, finalUrl: detailResponse.response.url, status: detailResponse.response.status, bytes: detailResponse.html.length, text: text.slice(0, 12000), imageUrls: imageUrls.slice(0, 60) };
}

const output = { checkedAt: new Date().toISOString(), cookiePresent: Boolean(cookie), selectedDate, dates, stages, firstListingRow: { dataId, rowText, rowImages }, detail };
await fs.writeFile("jpauc-past-form-diagnostic.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
