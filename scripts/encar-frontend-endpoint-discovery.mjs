import fs from "node:fs/promises";

const vehicleId = String(process.env.ENCAR_DISCOVERY_ID || "42154170").trim();
const output = process.env.ENCAR_DISCOVERY_OUTPUT || "encar-frontend-endpoints.json";
const headers = {
  accept: "text/html,application/xhtml+xml,application/javascript,*/*;q=0.8",
  "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
};

const pageUrl = `https://fem.encar.com/cars/detail/${encodeURIComponent(vehicleId)}`;
const pageResponse = await fetch(pageUrl, { headers, redirect: "follow" });
const html = await pageResponse.text();
const scriptUrls = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
  .map((match) => {
    try { return new URL(match[1], pageResponse.url || pageUrl).toString(); } catch { return ""; }
  })
  .filter(Boolean);

const endpointSet = new Set();
const snippets = [];
const keyPattern = /horsepower|horsePower|maxPower|enginePower|powerHp|powerPs|마력|출력|제원|specification|gradeCd|modelCd|modelGroupCd|displacement|driveType|bodyName/gi;
const endpointPattern = /(?:https?:\\?\/\\?\/api\.encar\.com)?\\?\/(?:v\d+|api)[^"'`\s\\)]{0,180}/gi;

function decode(value) {
  return String(value || "")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/");
}

async function inspect(url, index) {
  try {
    const response = await fetch(url, { headers, redirect: "follow" });
    if (!response.ok) return { url, status: response.status, bytes: 0, matches: 0 };
    const body = await response.text();
    for (const raw of body.match(endpointPattern) || []) {
      const endpoint = decode(raw).replace(/[;,]+$/, "");
      if (/vehicle|model|grade|spec|category|car/i.test(endpoint)) endpointSet.add(endpoint);
    }
    keyPattern.lastIndex = 0;
    let match;
    let count = 0;
    while ((match = keyPattern.exec(body)) && count < 50) {
      const start = Math.max(0, match.index - 220);
      const end = Math.min(body.length, match.index + 420);
      const snippet = decode(body.slice(start, end)).replace(/\s+/g, " ");
      snippets.push({ script: url, token: match[0], snippet });
      count++;
    }
    return { url, status: response.status, bytes: body.length, matches: count };
  } catch (error) {
    return { url, status: 0, error: String(error?.message || error), bytes: 0, matches: 0 };
  }
}

const inspected = [];
for (let i = 0; i < Math.min(scriptUrls.length, 80); i++) {
  inspected.push(await inspect(scriptUrls[i], i));
}

const report = {
  checkedAt: new Date().toISOString(),
  vehicleId,
  pageUrl,
  pageStatus: pageResponse.status,
  resolvedPageUrl: pageResponse.url,
  htmlBytes: html.length,
  scriptCount: scriptUrls.length,
  endpoints: [...endpointSet].sort(),
  inspected,
  snippets: snippets.slice(0, 500),
};
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  pageStatus: report.pageStatus,
  htmlBytes: report.htmlBytes,
  scriptCount: report.scriptCount,
  endpointCount: report.endpoints.length,
  snippetCount: report.snippets.length,
}, null, 2));
