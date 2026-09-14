import { lookup } from "node:dns/promises";
import { request } from "node:https";

// Never return error messages/URLs: fetch causes can contain bot credentials.
export function telegramNetworkError(error: unknown): string {
  const codes = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_TLS_CERT_ALTNAME_INVALID"]);
  const found = new Set<string>();
  const seen = new Set<unknown>();
  function visit(value: unknown, depth: number) {
    if (!value || typeof value !== "object" || depth > 4 || seen.has(value)) return;
    seen.add(value);
    const item = value as {code?: unknown; name?: unknown; cause?: unknown; errors?: unknown};
    if (typeof item.code === "string" && codes.has(item.code)) found.add(item.code);
    if (item.name === "TimeoutError" || item.name === "AbortError") found.add(item.name);
    visit(item.cause, depth + 1);
    if (Array.isArray(item.errors)) item.errors.slice(0, 8).forEach(e => visit(e, depth + 1));
  }
  visit(error, 0);
  return [...found].join(", ") || "NETWORK_ERROR";
}

export async function checkTelegramNetwork() {
  async function check(name: string, run: () => Promise<string>) {
    const start = Date.now();
    try { return {name, ok: true, detail: await run(), durationMs: Date.now() - start}; }
    catch (error) { return {name, ok: false, detail: telegramNetworkError(error), durationMs: Date.now() - start}; }
  }
  // Fixed public destination, no token or caller-supplied URL. All probes bounded.
  return Promise.all([
    check("DNS", async () => {
      const result = await Promise.race([
        lookup("api.telegram.org", {all: true}),
        new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new DOMException("", "TimeoutError")), 5000); timer.unref(); }),
      ]);
      return [...new Set(result.map(r => `IPv${r.family}`))].join(", ");
    }),
    check("HTTPS fetch", async () => {
      const response = await fetch("https://api.telegram.org/", {method: "HEAD", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(5000)});
      return `HTTP ${response.status}`;
    }),
    check("HTTPS IPv4", () => new Promise<string>((resolve, reject) => {
      const req = request("https://api.telegram.org/", {method: "HEAD", family: 4, signal: AbortSignal.timeout(5000)}, res => {
        res.resume();
        resolve(`HTTP ${res.statusCode}`);
      });
      req.on("error", reject);
      req.end();
    })),
  ]);
}
