import crypto from "node:crypto";
import { isCrmRole } from "./auth";
import { findCrmUserByTelegram, updateCrmUser } from "./crm-users";
import { mutateDataJson, readDataJson } from "./data";

const CHALLENGES_PATH = "auth/telegram-login-challenges.json";
const MAX_STORED_CHALLENGES = 200;

type LoginChallenge = {
  tokenHash: string;
  status: "pending" | "approved" | "denied";
  nextPath: string;
  createdAt: string;
  expiresAt: string;
  approvedAt?: string;
  userId?: string;
};

function cleanUsername(value: unknown) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function telegramApiUrl(method: string, token: string) {
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function sendMessage(token: string, chatId: string, text: string) {
  const response = await fetch(telegramApiUrl("sendMessage", token), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as { ok?: boolean; description?: string } | null;
  if (!response.ok || !payload?.ok) throw new Error(payload?.description || "telegram_sendMessage_failed");
}

function cleanChallenges(challenges: LoginChallenge[], now = Date.now()) {
  return challenges
    .filter((challenge) => Date.parse(challenge.expiresAt) > now)
    .slice(-MAX_STORED_CHALLENGES);
}

export async function handlePrivateEmployeeLoginStart(update: any, botToken: string) {
  const message = update?.message;
  if (!message?.chat?.id || message.chat.type !== "private") return false;

  const text = String(message.text || "").trim();
  const match = text.match(/^\/start(?:@[A-Za-z0-9_]+)?\s+login_([A-Za-z0-9_-]{16,64})$/);
  if (!match?.[1]) return false;

  const rawToken = match[1];
  const hash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const now = Date.now();
  const challenges = await readDataJson<LoginChallenge[]>(CHALLENGES_PATH, []);
  const challenge = (Array.isArray(challenges) ? challenges : []).find((item) => item.tokenHash === hash && Date.parse(item.expiresAt) > now);
  const chatId = String(message.chat.id);

  if (!challenge || challenge.status !== "pending") {
    await sendMessage(botToken, chatId, "Эта ссылка для входа уже использована или устарела. Вернитесь на страницу входа АвтоЦены и нажмите «Войти через Telegram» ещё раз.");
    return true;
  }

  const telegramId = String(message.from?.id || message.chat.id);
  const telegramUsername = cleanUsername(message.from?.username);
  const displayName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ").trim();
  const user = await findCrmUserByTelegram({ id: telegramId, username: telegramUsername });

  if (!user || !isCrmRole(user.role)) {
    await mutateDataJson<LoginChallenge[]>(CHALLENGES_PATH, [], (stored) =>
      cleanChallenges((Array.isArray(stored) ? stored : []).map((item) => item.tokenHash === hash ? { ...item, status: "denied" as const } : item), now));
    await sendMessage(botToken, chatId, "⛔ Этот Telegram не добавлен в команду АвтоЦены. Вход в CRM не разрешён.");
    return true;
  }

  const approvedAt = new Date(now).toISOString();
  await updateCrmUser(user.id, {
    telegramId,
    telegramUsername: telegramUsername || user.telegramUsername,
    displayName: displayName || user.displayName,
    lastLoginAt: approvedAt,
  });

  await mutateDataJson<LoginChallenge[]>(CHALLENGES_PATH, [], (stored) =>
    cleanChallenges((Array.isArray(stored) ? stored : []).map((item) => item.tokenHash === hash ? {
      ...item,
      status: "approved" as const,
      userId: user.id,
      approvedAt,
    } : item), now));

  await sendMessage(botToken, chatId, `✅ Вход в АвтоЦена CRM подтверждён${displayName ? `, ${displayName}` : ""}.\n\nВернитесь в браузер — CRM откроется автоматически.`);
  return true;
}
