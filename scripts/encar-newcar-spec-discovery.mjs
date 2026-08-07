import fs from "node:fs/promises";

const id = String(process.env.ENCAR_NEWCAR_ID || "42154170").trim();
const output = process.env.ENCAR_NEWCAR_OUTPUT || "encar-newcar-spec-discovery.json";
const pageUrl = `https://fem.encar.com/cars/newcar/${encodeURIComponent(id)}`;
const headers = {
  accept: "text/html,application/javascript,application/json,*/*;q=0.8",
  "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
};

function absolute(value, base) { try { return new URL(value, base).toString(); } catch { return ""; } }
function decode(value) { return String(value || "").replace(/\\u002f/gi, "/").replace(/\\\//g, "/"); }

const pageResponse = await fetch(pageUrl, { headers, redirect: "follow" });
const html = await pageResponse.text();
const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
  .map((m) => absolute(m[1], pageResponse.url || pageUrl)).filter(Boolean);
const endpoints = new Set();
const contexts = [];
for (const scriptUrl of scripts.slice(0, 80)) {
  try {
    const response = await fetch(scriptUrl, { headers, redirect: "follow" });
    if (!response.ok) continue;
    const body = await response.text();
    const endpointPatterns = [
      /["'`]([^"'`]{0,80}\/(?:api|v\d+|legacy|newprice|db)[^"'`\s]{1,220})["'`]/gi,
      /https?:\\?\/\\?\/[^"'`\s]+/gi,
    ];
    for (const pattern of endpointPatterns) {
      for (const match of body.matchAll(pattern)) {
        const raw = decode(match[1] || match[0]);
        if (/car|vehicle|model|grade|badge|spec|power|newprice|price/i.test(raw)) endpoints.add(raw);
      }
    }
    const tokenRe = /horsePower|horsepower|powerHp|maxPower|마력|출력|badgeCd|gradeCd|gradeDetailCd|vehicleId/gi;
    let token;
    while ((token = tokenRe.exec(body)) && contexts.length < 600) {
      contexts.push({ scriptUrl, token: token[0], context: decode(body.slice(Math.max(0, token.index - 1400), Math.min(body.length, token.index + 3200))).replace(/\s+/g, " ") });
    }
  } catch {}
}
const report = {
  checkedAt: new Date().toISOString(), id, pageUrl, status: pageResponse.status, resolvedUrl: pageResponse.url,
  htmlBytes: html.length, scripts, endpoints: [...endpoints].sort(), contexts,
};
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ status: report.status, htmlBytes: report.htmlBytes, scripts: scripts.length, endpoints: report.endpoints.length, contexts: contexts.length }, null, 2));
