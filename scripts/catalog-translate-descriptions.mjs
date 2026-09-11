import crypto from "node:crypto";
import fs from "node:fs/promises";
import { readDataJson, writeDataJson } from "../apps/web/lib/data.ts";
import { offerSpecificationGroups } from "../apps/web/lib/catalog/offer-specification-groups.ts";
import { needsTranslation, translationKey, validTranslation, TRANSLATION_CACHE_PATH } from "../apps/web/lib/catalog/specification-translation.ts";

const report = { offers: 0, unique: 0, translated: 0, rejected: 0, characters: 0, pending: 0, samples: [] };
const api = "https://translate.api.cloud.yandex.net/translate/v2/translate";
async function post(url, body, token) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  // Never log credentials, signed JWTs, tokens or full provider responses.
  if (!response.ok) throw new Error(`${url === api ? "translation" : "iam"}_http_${response.status}`);
  return response.json();
}
async function iamToken() {
  const key = JSON.parse(process.env.YC_SA_JSON_CREDENTIALS || "{}");
  if (!key.id || !key.private_key || !key.service_account_id) throw new Error("translation_credentials_missing");
  const now = Math.floor(Date.now() / 1000);
  const enc = obj => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const url = "https://iam.api.cloud.yandex.net/iam/v1/tokens";
  const unsigned = `${enc({ alg: "PS256", typ: "JWT", kid: key.id })}.${enc({ iss: key.service_account_id, aud: url, iat: now, exp: now + 3600 })}`;
  const signature = crypto.sign("sha256", Buffer.from(unsigned), { key: key.private_key.slice(key.private_key.indexOf("-----BEGIN")), padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }).toString("base64url");
  const result = await post(url, { jwt: `${unsigned}.${signature}` });
  if (!result.iamToken) throw new Error("translation_iam_token_missing");
  return result.iamToken;
}
async function main() {
  const manifest = await readDataJson("catalog/manifest.json", null);
  if (!manifest?.generationId) throw new Error("translation_manifest_missing");
  const wanted = new Map();
  for (const market of ["china", "korea"]) {
    const chunks = manifest.markets?.[market]?.chunks;
    if (!chunks?.length) throw new Error(`translation_market_missing:${market}`);
    for (const chunk of chunks) {
      const path = chunk.startsWith("catalog/") ? chunk : `catalog/generations/${manifest.generationId}/offers/${market}/${chunk}.json`;
      const offers = await readDataJson(path, null);
      if (!Array.isArray(offers)) throw new Error(`translation_chunk_missing:${market}`);
      for (const offer of offers) {
        report.offers++;
        for (const group of offerSpecificationGroups(offer)) {
          for (const text of [group.name, ...group.items.flatMap(item => [item.name, item.value])]) {
            if (needsTranslation(text)) wanted.set(translationKey(text), text);
          }
        }
      }
    }
  }
  report.unique = wanted.size;
  const previous = await readDataJson(TRANSLATION_CACHE_PATH, {});
  // Bound stored data to the scanned active inventory; never modify source offers.
  const cache = Object.fromEntries([...wanted].filter(([key, source]) => previous[key]?.source === source && validTranslation(source, previous[key].text)).map(([key]) => [key, previous[key]]));
  const missing = [...wanted].filter(([key]) => !cache[key]);
  const budget = Math.max(0, Math.min(200_000, Number(process.env.TRANSLATION_CHARACTER_BUDGET || 100_000)));
  if (!Number.isFinite(budget)) throw new Error("translation_budget_invalid");
  let token;
  let batch = [];
  let batchSize = 0;
  async function flush() {
    if (!batch.length) return;
    token ||= await iamToken();
    const result = await post(api, { targetLanguageCode: "ru", format: "PLAIN_TEXT", texts: batch.map(([, text]) => text) }, token);
    report.characters += batchSize;
    if (result.translations?.length !== batch.length) throw new Error("translation_result_count_mismatch");
    for (let i = 0; i < batch.length; i++) {
      const [key, source] = batch[i];
      const text = result.translations[i]?.text;
      if (typeof text === "string" && validTranslation(source, text)) {
        cache[key] = { source, text }; report.translated++;
        if (report.samples.length < 10) report.samples.push({ source, text });
      } else report.rejected++;
    }
    await writeDataJson(TRANSLATION_CACHE_PATH, cache);
    console.log(JSON.stringify({ translated: report.translated, characters: report.characters, rejected: report.rejected }));
    batch = []; batchSize = 0;
  }
  for (const entry of missing) {
    const size = [...entry[1]].length;
    if (size > 9000 || report.characters + batchSize + size > budget) continue;
    if (batchSize + size > 9000 || batch.length >= 100) await flush();
    batch.push(entry); batchSize += size;
  }
  await flush();
  await writeDataJson(TRANSLATION_CACHE_PATH, cache);
  report.pending = wanted.size - Object.keys(cache).length;
}
try { await main(); } catch (error) { report.error = error.message; process.exitCode = 1; }
await fs.writeFile("catalog-translation-report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
