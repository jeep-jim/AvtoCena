import crypto from "node:crypto";
import {
  appendChunkedDataJson,
  readChunkedDataJson,
  updateChunkedDataJson,
} from "./data";
import { getOffer, searchOffers } from "./catalog/storage";
import { CATALOG_MARKET_LABELS } from "./catalog/runtime-config";

const SITE_URL = "https://avtocena.com";
const LOGO_URL = `${SITE_URL}/apple-touch-icon.png`;
const USERS_PATH = "telegram/public-users.json";
const SUBSCRIPTIONS_PATH = "telegram/subscriptions.json";
const MENU_PROFILE_TTL_MS = 10 * 60_000;

const BUTTON_CARS = "🚗 Подобрать авто";
const BUTTON_CALCULATE = "🧮 Рассчитать";
const BUTTON_CATALOG = "📚 Каталог";
const BUTTON_REQUEST = "📝 Оставить заявку";
const BUTTON_SUBSCRIPTIONS = "🔔 Подписки";
const BUTTON_FAVORITES = "❤️ Избранное";
const BUTTON_OSAGO = "🛡 ОСАГО";
const BUTTON_CREDIT = "💳 Автокредит";
const BUTTON_SITE = "🌐 АвтоЦена";

let botProfileConfiguredAt = 0;

type PublicBotUser = {
  id: string;
  telegramUserId: string;
  chatId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
  startedAt: string;
  lastSeenAt: string;
};

type SubscriptionKind = "budget" | "model";

type PublicBotSubscription = {
  id: string;
  telegramUserId: string;
  chatId: string;
  kind: SubscriptionKind;
  budgetTo?: number;
  make?: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
  active: boolean;
  lastOfferIds: string[];
  lastCheckedAt?: string;
  lastError?: string;
};

class TelegramCallError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function cleanText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanUsername(value: unknown) {
  return cleanText(value).replace(/^@+/, "").toLowerCase();
}

function absoluteUrl(value: unknown) {
  const url = cleanText(value);
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `${SITE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

function formatRub(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? `${new Intl.NumberFormat("ru-RU").format(Math.round(number))} ₽`
    : "";
}

function formatKm(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? `${new Intl.NumberFormat("ru-RU").format(Math.round(number))} км`
    : "";
}

function formatEngine(value: unknown) {
  const cc = Number(value);
  return Number.isFinite(cc) && cc > 0 ? `${(cc / 1000).toFixed(1)} л` : "";
}

function marketLabel(value: unknown) {
  const market = cleanText(value);
  return (CATALOG_MARKET_LABELS as Record<string, string>)[market] || market;
}

function offerTitle(offer: any) {
  return [offer?.make, offer?.model, offer?.trim].map(cleanText).filter(Boolean).join(" ") || "Автомобиль";
}

function offerImage(offer: any) {
  const images = Array.isArray(offer?.images) ? offer.images : [];
  return absoluteUrl(images[0]?.url || offer?.cardImageUrl || "");
}

function offerPrice(offer: any) {
  return Number(offer?.totalRub || offer?.publicVisibleRub || 0);
}

function offerCardText(offer: any, prefix = "🚘") {
  const meta = [offer?.year, marketLabel(offer?.market), formatKm(offer?.mileageKm)].filter(Boolean).join(" · ");
  const specs = [
    formatEngine(offer?.engineCc),
    offer?.powerHp ? `${Math.round(Number(offer.powerHp))} л.с.` : "",
    cleanText(offer?.drive),
    cleanText(offer?.transmission),
  ].filter(Boolean).join(" · ");
  const price = formatRub(offerPrice(offer));
  return [
    `${prefix} ${offerTitle(offer)}`,
    meta,
    price ? `Под ключ: ${price}` : "",
    specs,
  ].filter(Boolean).join("\n");
}

function offerUrl(offer: any) {
  return `${SITE_URL}/cars/offer/${encodeURIComponent(String(offer?.id || ""))}`;
}

function budgetSiteUrl(budgetTo?: number) {
  const query = new URLSearchParams({
    utm_source: "telegram",
    utm_medium: "bot",
    utm_campaign: "public_bot",
  });
  if (budgetTo) query.set("budget", String(budgetTo));
  return `${SITE_URL}/cars?${query.toString()}`;
}

function requestSiteUrl() {
  return `${SITE_URL}/request?utm_source=telegram&utm_medium=bot&utm_campaign=public_bot`;
}

function mainReplyKeyboard() {
  return {
    keyboard: [
      [BUTTON_CARS, BUTTON_CALCULATE],
      [BUTTON_CATALOG, BUTTON_SUBSCRIPTIONS],
      [BUTTON_REQUEST, BUTTON_FAVORITES],
      [BUTTON_OSAGO, BUTTON_CREDIT],
      [BUTTON_SITE],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "Что хотите сделать?",
  };
}

async function telegramCall<T>(token: string, method: string, body: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await response.json().catch(() => null) as { ok?: boolean; result?: T; description?: string } | null;
  if (!response.ok || !payload?.ok) {
    throw new TelegramCallError(response.status, cleanText(payload?.description) || `telegram_${method}_${response.status}`);
  }
  return payload.result as T;
}

async function telegramBestEffort<T>(token: string, method: string, body: Record<string, unknown>) {
  try {
    return await telegramCall<T>(token, method, body);
  } catch (error) {
    console.error("telegram_public_bot_call_failed", method, error instanceof Error ? error.message : "unknown");
    return null;
  }
}

async function ensureBotProfile(token: string) {
  if (Date.now() - botProfileConfiguredAt < MENU_PROFILE_TTL_MS) return;
  botProfileConfiguredAt = Date.now();
  await Promise.allSettled([
    telegramCall(token, "setMyCommands", {
      commands: [
        { command: "menu", description: "Главное меню АвтоЦены" },
        { command: "cars", description: "Подобрать авто по бюджету" },
        { command: "subscriptions", description: "Мои подписки" },
        { command: "site", description: "Открыть avtocena.com" },
      ],
    }),
    telegramCall(token, "setMyShortDescription", {
      short_description: "Подбор и расчёт автомобилей под ключ по вашему бюджету.",
    }),
    telegramCall(token, "setMyDescription", {
      description: "АвтоЦена подбирает реальные автомобили из 6 рынков, показывает рассчитанную стоимость под ключ и помогает следить за новыми вариантами.",
    }),
    telegramCall(token, "setChatMenuButton", { menu_button: { type: "commands" } }),
  ]);
}

function identityFromUpdate(update: any) {
  const from = update?.callback_query?.from || update?.message?.from || null;
  const chat = update?.callback_query?.message?.chat || update?.message?.chat || null;
  return {
    telegramUserId: String(from?.id || chat?.id || ""),
    chatId: String(chat?.id || from?.id || ""),
    username: cleanUsername(from?.username) || undefined,
    firstName: cleanText(from?.first_name) || undefined,
    lastName: cleanText(from?.last_name) || undefined,
    languageCode: cleanText(from?.language_code) || undefined,
  };
}

async function rememberPublicUser(update: any) {
  const identity = identityFromUpdate(update);
  if (!identity.telegramUserId || !identity.chatId) return identity;
  const id = identity.telegramUserId;
  const now = new Date().toISOString();
  const users = await readChunkedDataJson<PublicBotUser>(USERS_PATH, []);
  const existing = users.find((item) => item.id === id);
  if (existing) {
    await updateChunkedDataJson<PublicBotUser>(USERS_PATH, id, (stored) => ({
      ...stored,
      ...identity,
      id,
      telegramUserId: id,
      lastSeenAt: now,
    }));
  } else {
    await appendChunkedDataJson<PublicBotUser>(USERS_PATH, {
      id,
      ...identity,
      telegramUserId: id,
      startedAt: now,
      lastSeenAt: now,
    });
  }
  return identity;
}

async function sendWelcome(token: string, chatId: string, firstName = "") {
  await ensureBotProfile(token);
  const caption = [
    `АвтоЦена${firstName ? ` — привет, ${firstName}!` : ""}`,
    "",
    "Подбор и расчёт автомобилей под ваш бюджет прямо в Telegram.",
    "",
    "• реальные предложения из 6 рынков",
    "• стоимость под ключ",
    "• подписки на модели и бюджет",
    "• переход к полной карточке и расчёту на avtocena.com",
  ].join("\n");

  const photoSent = await telegramBestEffort(token, "sendPhoto", {
    chat_id: chatId,
    photo: LOGO_URL,
    caption,
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚗 Подобрать авто", callback_data: "ac:cars" }],
        [{ text: "📚 Открыть каталог", url: `${SITE_URL}/cars?utm_source=telegram&utm_medium=bot` }],
      ],
    },
  });
  if (!photoSent) {
    await telegramCall(token, "sendMessage", {
      chat_id: chatId,
      text: caption,
      reply_markup: { inline_keyboard: [[{ text: "🚗 Подобрать авто", callback_data: "ac:cars" }]] },
    });
  }

  await telegramCall(token, "sendMessage", {
    chat_id: chatId,
    text: "Меню АвтоЦены всегда под строкой сообщения 👇",
    reply_markup: mainReplyKeyboard(),
  });
}

async function sendMainMenu(token: string, chatId: string) {
  await ensureBotProfile(token);
  await telegramCall(token, "sendMessage", {
    chat_id: chatId,
    text: "Что хотите сделать?",
    reply_markup: mainReplyKeyboard(),
  });
}

async function sendBudgetMenu(token: string, chatId: string) {
  await telegramCall(token, "sendMessage", {
    chat_id: chatId,
    text: "Выберите бюджет. Покажу до 5 свежих вариантов из каталога АвтоЦены с уже рассчитанной стоимостью под ключ.",
    reply_markup: {
      inline_keyboard: [
        [1_500_000, 2_000_000].map((value) => ({ text: `до ${formatRub(value)}`, callback_data: `ac:budget:${value}` })),
        [2_500_000, 3_000_000].map((value) => ({ text: `до ${formatRub(value)}`, callback_data: `ac:budget:${value}` })),
        [4_000_000, 5_000_000].map((value) => ({ text: `до ${formatRub(value)}`, callback_data: `ac:budget:${value}` })),
        [
          { text: `до ${formatRub(6_000_000)}`, callback_data: "ac:budget:6000000" },
          { text: "Любой", callback_data: "ac:budget:0" },
        ],
      ],
    },
  });
}

async function searchBudgetOffers(budgetTo?: number, make?: string, model?: string, pageSize = 48) {
  const result = await searchOffers({
    budgetTo: budgetTo || undefined,
    make: make || undefined,
    model: model || undefined,
    hasPrice: "yes",
    sort: budgetTo ? "totalRubDesc" : "updatedAt",
    page: 1,
    pageSize,
  });
  return Array.isArray(result.items) ? result.items : [];
}

function diverseOffers(items: any[], limit = 5) {
  const picked: any[] = [];
  const seen = new Set<string>();
  for (const offer of items) {
    const key = `${cleanText(offer?.make).toLowerCase()}::${cleanText(offer?.model).toLowerCase()}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    picked.push(offer);
    if (picked.length >= limit) return picked;
  }
  for (const offer of items) {
    if (picked.some((item) => item?.id === offer?.id)) continue;
    picked.push(offer);
    if (picked.length >= limit) break;
  }
  return picked;
}

async function sendOfferCard(token: string, chatId: string, offer: any, prefix = "🚘") {
  const text = offerCardText(offer, prefix);
  const replyMarkup = {
    inline_keyboard: [
      [{ text: "Открыть на АвтоЦене", url: offerUrl(offer) }],
      [{ text: "🔔 Следить за моделью", callback_data: `ac:subm:${String(offer?.id || "").slice(0, 48)}` }],
    ],
  };
  const image = offerImage(offer);
  if (image) {
    const sent = await telegramBestEffort(token, "sendPhoto", {
      chat_id: chatId,
      photo: image,
      caption: text,
      reply_markup: replyMarkup,
    });
    if (sent) return;
  }
  await telegramCall(token, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    reply_markup: replyMarkup,
  });
}

async function sendBudgetResults(token: string, chatId: string, budgetTo?: number) {
  await telegramBestEffort(token, "sendChatAction", { chat_id: chatId, action: "typing" });
  const offers = diverseOffers(await searchBudgetOffers(budgetTo), 5);
  if (!offers.length) {
    await telegramCall(token, "sendMessage", {
      chat_id: chatId,
      text: "По этому бюджету сейчас не нашёл готовых карточек. Можно открыть полный каталог или оставить заявку — менеджер проверит дополнительные источники.",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📚 Открыть каталог", url: budgetSiteUrl(budgetTo) }],
          [{ text: "📝 Оставить заявку", url: requestSiteUrl() }],
        ],
      },
    });
    return;
  }

  await telegramCall(token, "sendMessage", {
    chat_id: chatId,
    text: budgetTo
      ? `Нашёл варианты до ${formatRub(budgetTo)}. Цена в карточках — расчёт АвтоЦены под ключ.`
      : "Свежие варианты из каталога АвтоЦены. Цена в карточках — расчёт под ключ.",
  });
  for (const offer of offers) await sendOfferCard(token, chatId, offer);
  await telegramCall(token, "sendMessage", {
    chat_id: chatId,
    text: "Хотите, чтобы я следил за новыми машинами?",
    reply_markup: {
      inline_keyboard: [
        ...(budgetTo ? [[{ text: `🔔 Подписаться на бюджет до ${formatRub(budgetTo)}`, callback_data: `ac:subb:${budgetTo}` }]] : []),
        [{ text: "Показать все варианты на сайте", url: budgetSiteUrl(budgetTo) }],
        [{ text: "Другой бюджет", callback_data: "ac:cars" }],
      ],
    },
  });
}

function subscriptionId(userId: string, kind: SubscriptionKind, scope: string) {
  return crypto.createHash("sha256").update(`${userId}:${kind}:${scope}`).digest("hex").slice(0, 16);
}

async function currentOfferIds(criteria: { budgetTo?: number; make?: string; model?: string }, limit = 20) {
  const result = await searchOffers({
    budgetTo: criteria.budgetTo || undefined,
    make: criteria.make || undefined,
    model: criteria.model || undefined,
    hasPrice: "yes",
    sort: "updatedAt",
    page: 1,
    pageSize: Math.min(48, Math.max(1, limit)),
  });
  return (Array.isArray(result.items) ? result.items : [])
    .map((offer: any) => String(offer?.id || ""))
    .filter(Boolean)
    .slice(0, limit);
}

async function saveSubscription(
  identity: ReturnType<typeof identityFromUpdate>,
  input: { kind: SubscriptionKind; budgetTo?: number; make?: string; model?: string },
) {
  if (!identity.telegramUserId || !identity.chatId) throw new Error("telegram_identity_missing");
  const make = cleanText(input.make);
  const model = cleanText(input.model);
  const scope = input.kind === "budget" ? String(input.budgetTo || 0) : `${make}:${model}`;
  const id = subscriptionId(identity.telegramUserId, input.kind, scope);
  const now = new Date().toISOString();
  const lastOfferIds = await currentOfferIds({ budgetTo: input.budgetTo, make, model });
  const subscriptions = await readChunkedDataJson<PublicBotSubscription>(SUBSCRIPTIONS_PATH, []);
  const existing = subscriptions.find((item) => item.id === id);
  const record: PublicBotSubscription = {
    id,
    telegramUserId: identity.telegramUserId,
    chatId: identity.chatId,
    kind: input.kind,
    budgetTo: input.budgetTo || undefined,
    make: make || undefined,
    model: model || undefined,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    active: true,
    lastOfferIds,
  };
  if (existing) {
    await updateChunkedDataJson<PublicBotSubscription>(SUBSCRIPTIONS_PATH, id, () => record);
  } else {
    await appendChunkedDataJson<PublicBotSubscription>(SUBSCRIPTIONS_PATH, record);
  }
  return record;
}

function subscriptionLabel(item: PublicBotSubscription) {
  if (item.kind === "budget") return `до ${formatRub(item.budgetTo)}`;
  return [item.make, item.model].filter(Boolean).join(" ") || "модель";
}

async function showSubscriptions(token: string, chatId: string, telegramUserId: string) {
  const items = await readChunkedDataJson<PublicBotSubscription>(SUBSCRIPTIONS_PATH, []);
  const active = items.filter((item) => item.telegramUserId === telegramUserId && item.active);
  if (!active.length) {
    await telegramCall(token, "sendMessage", {
      chat_id: chatId,
      text: "У вас пока нет активных подписок. Подберите машину — под каждой карточкой можно включить слежение за моделью или за бюджетом.",
      reply_markup: { inline_keyboard: [[{ text: "🚗 Подобрать авто", callback_data: "ac:cars" }]] },
    });
    return;
  }
  await telegramCall(token, "sendMessage", {
    chat_id: chatId,
    text: `Активные подписки: ${active.length}\n\n${active.map((item, index) => `${index + 1}. ${item.kind === "budget" ? "Бюджет" : "Модель"}: ${subscriptionLabel(item)}`).join("\n")}`,
    reply_markup: {
      inline_keyboard: active.slice(0, 12).map((item) => [{
        text: `Отключить: ${subscriptionLabel(item)}`.slice(0, 60),
        callback_data: `ac:unsub:${item.id}`,
      }]),
    },
  });
}

async function disableSubscription(userId: string, id: string) {
  const items = await readChunkedDataJson<PublicBotSubscription>(SUBSCRIPTIONS_PATH, []);
  const existing = items.find((item) => item.id === id && item.telegramUserId === userId && item.active);
  if (!existing) return false;
  await updateChunkedDataJson<PublicBotSubscription>(SUBSCRIPTIONS_PATH, id, (stored) => ({
    ...stored,
    active: false,
    updatedAt: new Date().toISOString(),
  }));
  return true;
}

function parseBudgetText(value: string) {
  const normalized = value
    .replace(/(?:₽|руб(?:лей)?|р\.?)/gi, "")
    .replace(/[\s_]/g, "")
    .replace(/,/g, ".")
    .trim();
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 300_000 && number <= 50_000_000 ? Math.round(number) : 0;
}

async function answerCallback(token: string, callback: any, text = "") {
  const id = String(callback?.id || "");
  if (!id) return;
  await telegramBestEffort(token, "answerCallbackQuery", {
    callback_query_id: id,
    ...(text ? { text } : {}),
  });
}

async function handleCallback(update: any, token: string) {
  const callback = update?.callback_query;
  const data = cleanText(callback?.data);
  if (!callback || !data.startsWith("ac:")) return false;
  const identity = await rememberPublicUser(update);
  const chatId = identity.chatId;
  if (!chatId) return true;

  if (data === "ac:cars") {
    await answerCallback(token, callback);
    await sendBudgetMenu(token, chatId);
    return true;
  }
  if (data === "ac:menu") {
    await answerCallback(token, callback);
    await sendMainMenu(token, chatId);
    return true;
  }
  if (data === "ac:subs") {
    await answerCallback(token, callback);
    await showSubscriptions(token, chatId, identity.telegramUserId);
    return true;
  }

  const budgetMatch = data.match(/^ac:budget:(\d+)$/);
  if (budgetMatch) {
    await answerCallback(token, callback, "Подбираю варианты…");
    await sendBudgetResults(token, chatId, Number(budgetMatch[1]) || undefined);
    return true;
  }

  const subBudgetMatch = data.match(/^ac:subb:(\d+)$/);
  if (subBudgetMatch) {
    const budgetTo = Number(subBudgetMatch[1]);
    await saveSubscription(identity, { kind: "budget", budgetTo });
    await answerCallback(token, callback, "Подписка включена");
    await telegramCall(token, "sendMessage", {
      chat_id: chatId,
      text: `🔔 Готово. Буду следить за новыми вариантами до ${formatRub(budgetTo)}.`,
    });
    return true;
  }

  const subModelMatch = data.match(/^ac:subm:([A-Za-z0-9_-]{8,48})$/);
  if (subModelMatch) {
    const offer = await getOffer(subModelMatch[1]);
    if (!offer) {
      await answerCallback(token, callback, "Карточка уже недоступна");
      return true;
    }
    await saveSubscription(identity, { kind: "model", make: offer.make, model: offer.model });
    await answerCallback(token, callback, "Подписка включена");
    await telegramCall(token, "sendMessage", {
      chat_id: chatId,
      text: `🔔 Готово. Буду следить за новыми ${[offer.make, offer.model].filter(Boolean).join(" ")}.`,
    });
    return true;
  }

  const unsubMatch = data.match(/^ac:unsub:([a-f0-9]{16})$/i);
  if (unsubMatch) {
    const changed = await disableSubscription(identity.telegramUserId, unsubMatch[1]);
    await answerCallback(token, callback, changed ? "Подписка отключена" : "Уже отключена");
    await showSubscriptions(token, chatId, identity.telegramUserId);
    return true;
  }

  await answerCallback(token, callback);
  return true;
}

export async function handlePublicBotUpdate(update: any, token: string) {
  if (update?.callback_query) return handleCallback(update, token);
  const message = update?.message;
  if (!message?.chat?.id || message.chat.type !== "private") return false;
  const text = cleanText(message.text);
  if (!text) return false;

  const genericStart = /^\/start(?:@[A-Za-z0-9_]+)?$/i.test(text);
  const menuCommand = /^\/menu(?:@[A-Za-z0-9_]+)?$/i.test(text);
  const carsCommand = /^\/cars(?:@[A-Za-z0-9_]+)?$/i.test(text);
  const subscriptionsCommand = /^\/subscriptions(?:@[A-Za-z0-9_]+)?$/i.test(text);
  const siteCommand = /^\/site(?:@[A-Za-z0-9_]+)?$/i.test(text);
  const publicText = [
    BUTTON_CARS,
    BUTTON_CALCULATE,
    BUTTON_CATALOG,
    BUTTON_REQUEST,
    BUTTON_SUBSCRIPTIONS,
    BUTTON_FAVORITES,
    BUTTON_OSAGO,
    BUTTON_CREDIT,
    BUTTON_SITE,
  ].includes(text);
  const typedBudget = parseBudgetText(text);
  if (!genericStart && !menuCommand && !carsCommand && !subscriptionsCommand && !siteCommand && !publicText && !typedBudget) return false;

  const identity = await rememberPublicUser(update);
  const chatId = identity.chatId;
  if (!chatId) return true;

  if (genericStart) {
    await sendWelcome(token, chatId, identity.firstName || "");
    return true;
  }
  if (menuCommand) {
    await sendMainMenu(token, chatId);
    return true;
  }
  if (carsCommand || text === BUTTON_CARS || text === BUTTON_CALCULATE) {
    await sendBudgetMenu(token, chatId);
    return true;
  }
  if (typedBudget) {
    await sendBudgetResults(token, chatId, typedBudget);
    return true;
  }
  if (subscriptionsCommand || text === BUTTON_SUBSCRIPTIONS) {
    await showSubscriptions(token, chatId, identity.telegramUserId);
    return true;
  }

  const urlByText: Record<string, string> = {
    [BUTTON_CATALOG]: `${SITE_URL}/cars?utm_source=telegram&utm_medium=bot`,
    [BUTTON_REQUEST]: requestSiteUrl(),
    [BUTTON_FAVORITES]: `${SITE_URL}/favorites?utm_source=telegram&utm_medium=bot`,
    [BUTTON_OSAGO]: `${SITE_URL}/osago?utm_source=telegram&utm_medium=bot`,
    [BUTTON_CREDIT]: `${SITE_URL}/autocredit?utm_source=telegram&utm_medium=bot`,
    [BUTTON_SITE]: `${SITE_URL}/?utm_source=telegram&utm_medium=bot`,
  };
  const url = siteCommand ? `${SITE_URL}/?utm_source=telegram&utm_medium=bot` : urlByText[text];
  if (url) {
    await telegramCall(token, "sendMessage", {
      chat_id: chatId,
      text: text === BUTTON_OSAGO || text === BUTTON_CREDIT
        ? "Этот раздел открывается на сайте АвтоЦены. Партнёрские предложения внутри Telegram не размещаются."
        : "Открыть на АвтоЦене:",
      reply_markup: {
        inline_keyboard: [[{
          text: text.replace(/^[^\p{L}\p{N}]+/u, "") || "Открыть сайт",
          url,
        }]],
      },
    });
    return true;
  }

  return false;
}

export async function runPublicBotSubscriptionNotifications(token: string) {
  const all = await readChunkedDataJson<PublicBotSubscription>(SUBSCRIPTIONS_PATH, []);
  const active = all.filter((item) => item.active).slice(0, 250);
  const updates: Array<{ id: string; patch: Partial<PublicBotSubscription> }> = [];
  let delivered = 0;
  let checked = 0;

  for (const subscription of active) {
    checked += 1;
    const checkedAt = new Date().toISOString();
    try {
      const result = await searchOffers({
        budgetTo: subscription.budgetTo || undefined,
        make: subscription.make || undefined,
        model: subscription.model || undefined,
        hasPrice: "yes",
        sort: "updatedAt",
        page: 1,
        pageSize: 20,
      });
      const offers = Array.isArray(result.items) ? result.items : [];
      const currentIds = offers.map((offer: any) => String(offer?.id || "")).filter(Boolean).slice(0, 20);
      const previous = new Set(subscription.lastOfferIds || []);
      const newOffers = offers.filter((offer: any) => offer?.id && !previous.has(String(offer.id))).slice(0, 3);

      if ((subscription.lastOfferIds || []).length) {
        for (const offer of newOffers) {
          await sendOfferCard(token, subscription.chatId, offer, "🔔 Новый вариант");
          delivered += 1;
        }
      }

      updates.push({
        id: subscription.id,
        patch: {
          lastOfferIds: currentIds,
          lastCheckedAt: checkedAt,
          lastError: "",
          updatedAt: checkedAt,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "subscription_check_failed";
      const disabled = error instanceof TelegramCallError && error.status === 403;
      updates.push({
        id: subscription.id,
        patch: {
          lastCheckedAt: checkedAt,
          lastError: message.slice(0, 240),
          updatedAt: checkedAt,
          ...(disabled ? { active: false } : {}),
        },
      });
    }
  }

  for (const update of updates) {
    await updateChunkedDataJson<PublicBotSubscription>(SUBSCRIPTIONS_PATH, update.id, (stored) => ({
      ...stored,
      ...update.patch,
    }));
  }

  return { checked, delivered, active: active.length };
}
