import https from "node:https";
import { getJsonStorage } from "../data";
import { decryptConfig, type BrowserConfig, type Envelope } from "./config";
let cached: { at: number; value: BrowserConfig | null } | undefined;
export async function browserConfig() {
 if (cached && Date.now() - cached.at < 10000) return cached.value;
 let value: BrowserConfig | null = null;
 try { const envelope = await getJsonStorage().readJson<Envelope | null>("browser-pilot/runtime.json", null); if (envelope) value = decryptConfig(envelope, process.env.AUTH_SECRET || ""); } catch { /* Fail closed, never log credentials. */ }
 cached = {at: Date.now(), value}; return value;
}
export function callBrowser(config: BrowserConfig, body: Record<string, unknown>): Promise<{status: number; data: Buffer; type: string}> {
 return new Promise((resolve, reject) => {
  const bytes = Buffer.from(JSON.stringify(body));
  const request = https.request(config.url, {method: "POST", ca: config.ca, servername: "browser-pilot.internal", headers: {Authorization: `Bearer ${config.key}`, "Content-Type": "application/json", "Content-Length": bytes.length}}, response => {
   const chunks: Buffer[] = []; let size = 0;
   response.on("data", chunk => { size += chunk.length; if (size > 1500000) { request.destroy(Error("browser_response_too_large")); return; } chunks.push(chunk); });
   response.on("error", reject);
   response.on("end", () => resolve({status: response.statusCode || 502, data: Buffer.concat(chunks), type: response.headers["content-type"] === "image/jpeg" ? "image/jpeg" : "application/json"}));
  });
  const timer = setTimeout(() => request.destroy(Error("browser_timeout")), body.action === "send" ? 35000 : 12000);
  request.on("close", () => clearTimeout(timer)); request.on("error", reject); request.end(bytes);
 });
}
