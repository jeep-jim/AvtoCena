import crypto from "node:crypto";
import { readDataJson, writeDataJson } from "@/lib/data";

const TELEGRAM_CONFIG_PATH = "settings/telegram.json";
const TELEGRAM_BOT_USERNAME = "avtocena_bot";
const TELEGRAM_WEBHOOK_URL = "https://avtocena.com/api/telegram/webhook";

type EncryptedValue = {
  iv: string;
  tag: string;
  ciphertext: string;
};

type StoredTelegramConfig = {
  version: 1;
  username: string;
  botId?: string;
  firstName?: string;
  encryptedToken: EncryptedValue;
  encryptedClientSecret?: EncryptedValue;
  webhookUrl?: string;
  webhookConfiguredAt?: string;
  pendingUpdateCount?: number;
  updatedAt: string;
};

export type TelegramRuntimeConfig = {
  token: string;
  clientSecret?: string;
  username: string;
  webhookSecret: string;
  botId?: string;
  firstName?: string;
  webhookUrl: string;
  webhookConfiguredAt?: string;
};

export type TelegramPublicConfig = {
  configured: boolean;
  oidcConfigured: boolean;
  username: string;
  botId?: string;
  firstName?: string;
  webhookUrl: string;
  webhookConfiguredAt?: string;
  pendingUpdateCount?: number;
  updatedAt?: string;
};

function normalizeUsername(value: unknown) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function authSecret() {
  const value = process.env.AUTH_SECRET || "";
  if (!value) throw new Error("telegram_config_auth_secret_missing");
  return value;
}

function encryptionKey() {
  return crypto.createHash("sha256")
    .update(`avtocena:telegram-config:${authSecret()}`)
    .digest();
}

function encryptValue(value: string): EncryptedValue {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

function decryptValue(value: EncryptedValue) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(value.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function deriveTelegramWebhookSecret(username = TELEGRAM_BOT_USERNAME) {
  const normalized = normalizeUsername(username) || TELEGRAM_BOT_USERNAME;
  return crypto.createHmac("sha256", authSecret())
    .update(`avtocena:telegram-webhook:${normalized}`)
    .digest("hex");
}

async function readStoredTelegramConfig() {
  const stored = await readDataJson<StoredTelegramConfig | null>(TELEGRAM_CONFIG_PATH, null);
  if (!stored || stored.version !== 1 || !stored.encryptedToken) return null;
  return stored;
}

export async function getTelegramRuntimeConfig(): Promise<TelegramRuntimeConfig | null> {
  const envToken = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const envClientSecret = String(process.env.TELEGRAM_CLIENT_SECRET || "").trim();
  const envUsername = normalizeUsername(process.env.TELEGRAM_BOT_USERNAME || process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME);
  const stored = await readStoredTelegramConfig().catch(() => null);

  let token = envToken;
  let clientSecret = envClientSecret;
  try {
    if (!token && stored?.encryptedToken) token = decryptValue(stored.encryptedToken);
    if (!clientSecret && stored?.encryptedClientSecret) clientSecret = decryptValue(stored.encryptedClientSecret);
  } catch (error) {
    console.error("telegram_config_decrypt_failed", error instanceof Error ? error.message : "decrypt_failed");
    return null;
  }
  if (!token) return null;

  const username = envUsername || normalizeUsername(stored?.username) || TELEGRAM_BOT_USERNAME;
  const webhookSecret = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim()
    || deriveTelegramWebhookSecret(username);

  return {
    token,
    clientSecret: clientSecret || undefined,
    username,
    webhookSecret,
    botId: stored?.botId,
    firstName: stored?.firstName,
    webhookUrl: stored?.webhookUrl || TELEGRAM_WEBHOOK_URL,
    webhookConfiguredAt: stored?.webhookConfiguredAt,
  };
}

export async function getTelegramPublicConfig(): Promise<TelegramPublicConfig> {
  const envToken = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const envClientSecret = String(process.env.TELEGRAM_CLIENT_SECRET || "").trim();
  const envUsername = normalizeUsername(process.env.TELEGRAM_BOT_USERNAME || process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME);
  const stored = await readStoredTelegramConfig().catch(() => null);
  const username = envUsername || normalizeUsername(stored?.username) || (envToken ? TELEGRAM_BOT_USERNAME : "");
  return {
    configured: Boolean(envToken || stored?.encryptedToken),
    oidcConfigured: Boolean(envClientSecret || stored?.encryptedClientSecret),
    username,
    botId: stored?.botId,
    firstName: stored?.firstName,
    webhookUrl: stored?.webhookUrl || TELEGRAM_WEBHOOK_URL,
    webhookConfiguredAt: stored?.webhookConfiguredAt,
    pendingUpdateCount: stored?.pendingUpdateCount,
    updatedAt: stored?.updatedAt,
  };
}

export async function saveTelegramRuntimeConfig(input: {
  token: string;
  clientSecret?: string;
  username?: string;
  botId?: string;
  firstName?: string;
  webhookUrl?: string;
  webhookConfiguredAt?: string;
  pendingUpdateCount?: number;
}) {
  const token = String(input.token || "").trim();
  const clientSecret = String(input.clientSecret || "").trim();
  const username = normalizeUsername(input.username) || TELEGRAM_BOT_USERNAME;
  if (!token) throw new Error("telegram_token_required");
  if (username !== TELEGRAM_BOT_USERNAME) throw new Error("telegram_username_mismatch");

  const previous = await readStoredTelegramConfig().catch(() => null);
  const stored: StoredTelegramConfig = {
    version: 1,
    username,
    botId: input.botId ? String(input.botId) : previous?.botId,
    firstName: input.firstName ? String(input.firstName).slice(0, 160) : previous?.firstName,
    encryptedToken: encryptValue(token),
    encryptedClientSecret: clientSecret ? encryptValue(clientSecret) : previous?.encryptedClientSecret,
    webhookUrl: input.webhookUrl || previous?.webhookUrl || TELEGRAM_WEBHOOK_URL,
    webhookConfiguredAt: input.webhookConfiguredAt ?? previous?.webhookConfiguredAt,
    pendingUpdateCount: Number.isFinite(Number(input.pendingUpdateCount))
      ? Number(input.pendingUpdateCount)
      : previous?.pendingUpdateCount,
    updatedAt: new Date().toISOString(),
  };
  await writeDataJson(TELEGRAM_CONFIG_PATH, stored);
  return getTelegramPublicConfig();
}

export function expectedTelegramBotUsername() {
  return TELEGRAM_BOT_USERNAME;
}

export function telegramWebhookUrl() {
  return TELEGRAM_WEBHOOK_URL;
}
