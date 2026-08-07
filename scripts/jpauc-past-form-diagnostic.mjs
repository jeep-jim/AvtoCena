import fs from "node:fs/promises";

const headers = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ja;q=0.8",
  referer: "https://jpauc.com/auction",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};
const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();

async function fetchText(url, options = {}) {
  const response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(30000), ...options });
  return { response, text: await response.text() };
}

const { response, text: html } = await fetchText("https://jpauc.com/auction/past");
const dates = [...html.matchAll(/name=["']checkdate\[\]["'][^>]*value=["']([^"']+)["']/gi)].map((m) => m[1]);
const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)].map((m) => clean(m[0]).slice(0, 6000));
const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((m) => m[1])
  .filter((code) => /submit|checkdate|auction|past|form/i.test(code))
  .map((code) => clean(code).slice(0, 10000));

const jsResponse = await fetchText("https://jpauc.com/js/jpauc.js");
const js = clean(jsResponse.text).slice(0, 20000);

const output = {
  checkedAt: new Date().toISOString(),
  status: response.status,
  bytes: html.length,
  dates,
  forms,
  inlineScripts,
  jpaucJs: { status: jsResponse.response.status, bytes: jsResponse.text.length, source: js },
};
await fs.writeFile("jpauc-past-form-diagnostic.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
