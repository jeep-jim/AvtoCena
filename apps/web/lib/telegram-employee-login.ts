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

async function telegramCall(token: string, method: string, body: Record<string, unknown>) {
  const response = await fetch(telegramApiUrl(method, token), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as { ok?: boolean; description?: string } | null;
  if (!response.ok || !payload?.ok) throw new Error(payload?.description || `telegram_${method}_failed`);
}

async function telegramCallBestEffort(token: string, method: string, body: Record<string, unknown>) {
  try {
    await telegramCall(token, method, body);
  } catch (error) {
    console.error("telegram_employee_login_notify_failed", method, error instanceof Error ? error.message : "unknown");
  }
}

function cleanChallenges(challenges: LoginChallenge[], now = Date.now()) {
  return challenges
    .filter((challenge) => Date.parse(challenge.expiresAt) > now)
    .slice(-MAX_STORED_CHALLENGES);
}

function pendingChallenges(challenges: LoginChallenge[], now = Date.now()) {
  return cleanChallenges(challenges, now)
    .filter((challenge) => challenge.status === "pending")
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function callbackId(challenge: LoginChallenge) {
  return challenge.tokenHash.slice(0, 20);
}

async function resolveTelegramUser(from: any, fallbackChatId?: string) {
  const telegramId = String(from?.id || fallbackChatId || "");
  const telegramUsername = cleanUsername(from?.username);
  const displayName = [from?.first_name, from?.last_name].filter(Boolean).join(" ").trim();
  const user = await findCrmUserByTelegram({ id: telegramId, username: telegramUsername });
  return { telegramId, telegramUsername, displayName, user };
}

async function markChallengeApproved(
  challenge: LoginChallenge,
  identity: { telegramId: string; telegramUsername: string; displayName: string; user: any },
  now = Date.now(),
) {
  const { telegramId, telegramUsername, displayName, user } = identity;
  if (!user || !isCrmRole(user.role)) return false;

  const approvedAt = new Date(now).toISOString();
  await updateCrmUser(user.id, {
    telegramId,
    telegramUsername: telegramUsername || user.telegramUsername,
    displayName: displayName || user.displayName,
    lastLoginAt: approvedAt,
  });

  await mutateDataJson<LoginChallenge[]>(CHALLENGES_PATH, [], (stored) =>
    cleanChallenges((Array.isArray(stored) ? stored : []).map((item) => item.tokenHash === challenge.tokenHash ? {
      ...item,
      status: "approved" as const,
      userId: user.id,
      approvedAt,
    } : item), now));

  return true;
}

async function sendLoginButton(botToken: string, chatId: string, challenge: LoginChallenge, displayName = "") {
  await telegramCall(botToken, "sendMessage", {
    chat_id: chatId,
    text: `Вход в АвтоЦена CRM${displayName ? ` для ${displayName}` : ""}.\n\nНажмите кнопку ниже — браузер войдёт автоматически.`,
    reply_markup: {
      inline_keyboard: [[{
        text: "✅ Войти в CRM",
        callback_data: `crm_login:${callbackId(challenge)}`,
      }]],
    },
  });
}

async function approveChallenge(botToken: string, callback: any) {
  const data = String(callback?.data || "").trim();
  const match = data.match(/^crm_login:([a-f0-9]{20})$/i);
  if (!match?.[1]) return false;

  const selector = match[1].toLowerCase();
  const chatId = String(callback?.message?.chat?.id || "");
  const callbackQueryId = String(callback?.id || "");
  const now = Date.now();
  const challenges = await readDataJson<LoginChallenge[]>(CHALLENGES_PATH, []);
  const challenge = pendingChallenges(Array.isArray(challenges) ? challenges : [], now)
    .find((item) => item.tokenHash.startsWith(selector));

  if (!challenge) {
    if (callbackQueryId) {
      await telegramCallBestEffort(botToken, "answerCallbackQuery", {
        callback_query_id: callbackQueryId,
        text: "Попытка входа устарела. Начните вход на сайте ещё раз.",
        show_alert: true,
      });
    }
    return true;
  }

  const identity = await resolveTelegramUser(callback?.from, chatId);
  if (!identity.user || !isCrmRole(identity.user.role)) {
    await mutateDataJson<LoginChallenge[]>(CHALLENGES_PATH, [], (stored) =>
      cleanChallenges((Array.isArray(stored) ? stored : []).map((item) => item.tokenHash === challenge.tokenHash ? {
        ...item,
        status: "denied" as const,
      } : item), now));
    if (callbackQueryId) {
      await telegramCallBestEffort(botToken, "answerCallbackQuery", {
        callback_query_id: callbackQueryId,
        text: "Этот Telegram не добавлен в команду АвтоЦены.",
        show_alert: true,
      });
    }
    return true;
  }

  await markChallengeApproved(challenge, identity, now);

  if (callbackQueryId) {
    await telegramCallBestEffort(botToken, "answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text: "Вход подтверждён",
    });
  }

  if (chatId && callback?.message?.message_id) {
    await telegramCallBestEffort(botToken, "editMessageText", {
      chat_id: chatId,
      message_id: callback.message.message_id,
      text: `✅ Вход в АвтоЦена CRM подтверждён${identity.displayName ? `, ${identity.displayName}` : ""}.\n\nВернитесь в браузер — CRM откроется автоматически.`,
    });
  }
  return true;
}

export async function handlePrivateEmployeeLoginStart(update: any, botToken: string) {
  if (update?.callback_query) {
    return approveChallenge(botToken, update.callback_query);
  }

  const message = update?.message;
  if (!message?.chat?.id || message.chat.type !== "private") return false;

  const text = String(message.text || "").trim();
  const exactMatch = text.match(/^\/start(?:@[A-Za-z0-9_]+)?\s+login_([A-Za-z0-9_-]{16,64})$/);
  const genericLogin = /^\/(?:start|login)(?:@[A-Za-z0-9_]+)?$/i.test(text)
    || /^(?:войти|войти в crm|🔐\s*войти в crm)$/i.test(text);
  if (!exactMatch?.[1] && !genericLogin) return false;

  const now = Date.now();
  const stored = await readDataJson<LoginChallenge[]>(CHALLENGES_PATH, []);
  const pending = pendingChallenges(Array.isArray(stored) ? stored : [], now);
  const challenge = exactMatch?.[1]
    ? pending.find((item) => item.tokenHash === crypto.createHash("sha256").update(exactMatch[1]).digest("hex"))
    : pending[0];
  const chatId = String(message.chat.id);
  const identity = await resolveTelegramUser(message.from, chatId);

  if (!identity.user || !isCrmRole(identity.user.role)) {
    await telegramCallBestEffort(botToken, "sendMessage", {
      chat_id: chatId,
      text: "⛔ Этот Telegram не добавлен в команду АвтоЦены. Вход в CRM не разрешён.",
    });
    return true;
  }

  if (!challenge) {
    await telegramCallBestEffort(botToken, "sendMessage", {
      chat_id: chatId,
      text: "Сейчас нет активной попытки входа. Откройте avtocena.com/login, нажмите «Войти через Telegram», затем вернитесь сюда.",
      reply_markup: {
        inline_keyboard: [[{
          text: "Открыть страницу входа",
          url: "https://avtocena.com/login",
        }]],
      },
    });
    return true;
  }

  const exactChallenge = Boolean(exactMatch?.[1]);
  const canAutoApprove = exactChallenge || pending.length === 1;

  if (canAutoApprove) {
    const approved = await markChallengeApproved(challenge, identity, now);
    if (approved) {
      await telegramCallBestEffort(botToken, "sendMessage", {
        chat_id: chatId,
        text: `✅ Вход в АвтоЦена CRM подтверждён${identity.displayName ? `, ${identity.displayName}` : ""}.\n\nВернитесь в браузер — CRM откроется автоматически.`,
        reply_markup: {
          inline_keyboard: [[{
            text: "Открыть CRM",
            url: "https://avtocena.com/crm",
          }]],
        },
      });
      return true;
    }
  }

  await sendLoginButton(botToken, chatId, challenge, identity.displayName || identity.user.displayName);
  return true;
}
