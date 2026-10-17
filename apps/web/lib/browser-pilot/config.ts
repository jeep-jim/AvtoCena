import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
export type BrowserConfig = { enabled: boolean; url: string; key: string; ca: string; expiresAt: number; instanceId: string; releaseSha: string };
export type Envelope = { version: 1; iv: string; tag: string; data: string };
const key = (secret: string) => { if (secret.length < 20) throw Error("browser_secret_missing"); return createHash("sha256").update("avtocena-browser-pilot-config-v1\0" + secret).digest(); };
export function encryptConfig(value: BrowserConfig, secret: string): Envelope {
 const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(secret), iv);
 const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
 return {version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64")};
}
export function decryptConfig(value: Envelope, secret: string): BrowserConfig {
 if (value.version !== 1) throw Error("browser_config_invalid");
 const cipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(value.iv, "base64"));
 cipher.setAuthTag(Buffer.from(value.tag, "base64"));
 const config = JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.data, "base64")), cipher.final()]).toString());
 const url = new URL(config.url);
 if (url.protocol !== "https:" || url.port !== "8443" || url.pathname !== "/v1" || url.username || url.password || url.search || url.hash || typeof config.key !== "string" || config.key.length < 40 || typeof config.ca !== "string" || !Number.isFinite(config.expiresAt)) throw Error("browser_config_invalid");
 return config;
}
