import fs from "node:fs/promises";

const baseHeaders = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ja;q=0.8",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};
const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();

const first = await fetch("https://jpauc.com/auction/past", {
  headers: { ...baseHeaders, referer: "https://jpauc.com/auction" },
  redirect: "follow",
  signal: AbortSignal.timeout(30000),
});
const html = await first.text();
const cookie = String(first.headers.get("set-cookie") || "").split(";")[0];
const dates = [...html.matchAll(/name=["']checkdate\[\]["'][^>]*value=["']([^"']+)["']/gi)].map((m) => m[1]);
const selectedDate = dates[0];
if (!selectedDate) throw new Error("jpauc_no_past_date");

const body = new URLSearchParams();
body.append("checkdate[]", selectedDate);
body.append("submit", "submitauction");

const posted = await fetch("https://jpauc.com/auction/past", {
  method: "POST",
  headers: {
    ...baseHeaders,
    "content-type": "application/x-www-form-urlencoded",
    cookie,
    origin: "https://jpauc.com",
    referer: "https://jpauc.com/auction/past",
  },
  body: body.toString(),
  redirect: "follow",
  signal: AbortSignal.timeout(30000),
});
const postedHtml = await posted.text();

const hrefs = [...postedHtml.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
const auctionLinks = [...new Set(hrefs.filter((href) => /auction|maker|model|listing|detail|past|search|lot/i.test(href)))].slice(0, 400);
const detailLinks = [...new Set(hrefs.filter((href) => /\/auction\/detail\//i.test(href)))].slice(0, 100);
const forms = [...postedHtml.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)].map((m) => clean(m[0]).slice(0, 8000)).slice(0, 20);
const titles = [...postedHtml.matchAll(/<(?:h1|h2|h3|th|td|label|option)\b[^>]*>([\s\S]*?)<\/(?:h1|h2|h3|th|td|label|option)>/gi)]
  .map((m) => clean(m[1].replace(/<[^>]+>/g, " ")))
  .filter(Boolean)
  .slice(0, 300);

const output = {
  checkedAt: new Date().toISOString(),
  initial: { status: first.status, bytes: html.length, dates, cookiePresent: Boolean(cookie) },
  submission: {
    selectedDate,
    requestBody: body.toString(),
    status: posted.status,
    finalUrl: posted.url,
    bytes: postedHtml.length,
    detailLinks,
    auctionLinks,
    forms,
    textSamples: titles,
  },
};
await fs.writeFile("jpauc-past-form-diagnostic.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
