import fs from "node:fs/promises";

const source = String(process.env.CHINA_SHAPE_SOURCE || "");
const output = process.env.CHINA_SHAPE_OUTPUT || `china-shape-${source}.json`;
const urls = source === "guazi"
  ? ["https://www.guazi.com/", "https://www.guazi.com/buy/"]
  : ["https://www.che168.com/china/list/"];
const headers = { accept: "text/html,application/xhtml+xml,*/*;q=0.8", "accept-language": "zh-CN,zh;q=0.9,en;q=0.6", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36" };

function count(text, re) { return [...text.matchAll(re)].length; }
function samples(text, re, limit = 20) { return [...text.matchAll(re)].slice(0, limit).map((m) => m[0].slice(0, 500)); }

const reports = [];
for (const url of urls) {
  try {
    const response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(30000) });
    const html = await response.text();
    reports.push({
      requestedUrl: url,
      finalUrl: response.url,
      status: response.status,
      bytes: html.length,
      counts: {
        href: count(html, /href\s*=\s*["'][^"']+/gi),
        carDetail: count(html, /car-detail/gi),
        dealerDetail: count(html, /\/dealer\/\d+\/\d+/gi),
        nextData: count(html, /__NEXT_DATA__/gi),
        nextFlight: count(html, /__next_f|self\.__next_f/gi),
        initialState: count(html, /INITIAL_STATE|initialState|pageProps|apollo|hydration/gi),
        cLongIds: count(html, /c\d{9,}/g),
        longIds: count(html, /\b\d{7,18}\b/g),
        wanPrice: count(html, /\d+(?:\.\d+)?\s*万/g),
      },
      hrefSamples: samples(html, /href\s*=\s*["'][^"']{1,220}/gi, 30),
      carSamples: samples(html, /.{0,120}(?:car-detail|\/dealer\/\d+\/\d+|carId|carid|clueId|vehicleId|sourceId|price).{0,260}/gi, 30),
      scriptTypes: samples(html, /<script\b[^>]{0,300}>/gi, 30),
    });
  } catch (error) {
    reports.push({ requestedUrl: url, error: String(error?.message || error) });
  }
}
await fs.writeFile(output, JSON.stringify({ source, checkedAt: new Date().toISOString(), reports }, null, 2));
console.log(JSON.stringify({ source, reports: reports.map((r) => ({ requestedUrl: r.requestedUrl, finalUrl: r.finalUrl, status: r.status, bytes: r.bytes, counts: r.counts, hrefSamples: r.hrefSamples?.slice(0, 8), carSamples: r.carSamples?.slice(0, 8), scriptTypes: r.scriptTypes?.slice(0, 8) })) }, null, 2));
