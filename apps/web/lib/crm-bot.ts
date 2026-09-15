import crypto from "node:crypto";
import { type AuthUser, getAuthUsers, normalizeTelegramUsername } from "./auth";
import {
  botAdmin,
  issueStaffKey,
  type StaffUser,
} from "./crm-access";
import {
  readDataJson,
  mutateDataJson,
  readChunkedDataJson,
  updateChunkedDataJson,
  appendChunkedDataJson,
} from "./data";
import { telegramSend, enqueueMessage, leadNotice } from "./crm-notifications";
import { leadStatusLabel } from "./crm";
const SITE = "https://avtocena.com";
type Dialog = {
  mode?: string;
  leadId?: string;
  offerId?: string;
  description?: string;
  requestId?: string;
  updatedAt?: number;
};
const dialogPath = (id: string) => `telegram/crm-dialogs/${id}.json`;
const ownLeads = async (id: string) =>
  (await readChunkedDataJson<any>("leads/leads.json", [])).filter(
    (lead) => String(lead.telegramUserId || "") === id && !lead.archivedAt,
  );
const adminKeyboard = [
  [
    { text: "📥 Входящие заявки", callback_data: "crm:inbox" },
    { text: "👥 Команда", callback_data: "crm:team" },
  ],
  [{ text: "Открыть CRM", url: `${SITE}/crm` }],
];
const customerKeyboard = [
  [{ text: "Перейти в каталог", url: `${SITE}/cars` }],
  [{ text: "Оставить заявку", url: `${SITE}/request` }],
];
export async function sendCustomerWelcome(token: string, id: string) {
  await telegramSend(token, id, "Добро пожаловать в АвтоЦену! 🚗\n\nМы помогаем выбрать автомобиль из-за рубежа и рассчитать его стоимость. На сайте можно посмотреть автомобили и оставить заявку менеджеру.");
  await telegramSend(token, id, "Обращения принимаем через форму на сайте. Выберите автомобиль в каталоге или оставьте заявку на подбор. Укажите удобный способ связи — менеджер свяжется с вами.", customerKeyboard);
}
async function saveDialog(id: string, value: Dialog) {
  await mutateDataJson<Dialog>(dialogPath(id), {}, () => ({
    ...value,
    updatedAt: Date.now(),
  }));
}
async function adminMenu(token: string, id: string) {
  await telegramSend(token,id,"АвтоЦена · команда",{keyboard:[["📥 Заявки","👥 Команда"],["🌐 Открыть CRM"]],resize_keyboard:true});
  await fetch(`https://api.telegram.org/bot${token}/setMyCommands`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({scope:{type:"chat",chat_id:id},commands:[{command:"inbox",description:"Входящие заявки"},{command:"team",description:"Команда и доступ"},{command:"menu",description:"Меню"},{command:"cancel",description:"Отменить ответ"}]}),signal:AbortSignal.timeout(2000)}).catch(()=>null);
  await telegramSend(
    token,
    id,
    "Рабочее пространство АвтоЦены. Заявки и служебные действия доступны только владельцам и администраторам команды.",
    adminKeyboard,
  );
}
async function teamMenu(token: string, id: string) {
  const users = await readDataJson<StaffUser[]>(
    "auth/users.json",
    getAuthUsers(),
  );
  await telegramSend(
    token,
    id,
    `Команда\n\n${users.map((user) => `${user.displayName} · @${user.telegramUsername} · ${user.role === "owner" ? "Владелец" : user.role === "admin" ? "Администратор" : "Менеджер"}${user.status === "disabled" ? " · отключён" : ""}`).join("\n")}\n\nДобавить сотрудника:\n/invite username admin\n/invite username manager\n\nВыдать новый персональный ключ:\n/key username\n\nОтключить сотрудника:\n/disable username\n\nПосле входа на сайт сотрудник нажимает «Подключить мой Telegram» в своей карточке. Назначение роли само по себе не подтверждает Telegram-аккаунт.`,
    [[{ text: "Команда в CRM", url: `${SITE}/crm/managers` }]],
  );
}
async function staffCommand(
  token: string,
  id: string,
  actor: AuthUser,
  text: string,
) {
  const match = text.match(
    /^\/(invite|key|disable)\s+@?([A-Za-z][A-Za-z0-9_]{4,31})(?:\s+(admin|manager))?$/i,
  );
  if (!match) return false;
  const command = match[1].toLowerCase();
  const username = normalizeTelegramUsername(match[2]);
  let target: StaffUser | undefined;
  const users = await readDataJson<StaffUser[]>(
    "auth/users.json",
    getAuthUsers(),
  );
  target = users.find(
    (user) => normalizeTelegramUsername(user.telegramUsername) === username,
  );
  if (command === "invite") {
    if (target) {
      await telegramSend(
        token,
        id,
        "Сотрудник уже существует. Для изменения роли откройте «Команда и права». Новый ключ: /key username",
      );
      return true;
    }
    if (!match[3]) {
      await telegramSend(
        token,
        id,
        "Укажите роль: /invite username admin или /invite username manager",
      );
      return true;
    }
    const candidate: StaffUser = {
      id: `user_${crypto.randomUUID()}`,
      telegramUsername: username,
      displayName: username,
      role: match[3] as "admin" | "manager",
      status: "active",
      companyId: actor.companyId,
      sessionVersion: 0,
    };
    await mutateDataJson<StaffUser[]>(
      "auth/users.json",
      getAuthUsers(),
      (current) => {
        if (
          current.some(
            (user) =>
              normalizeTelegramUsername(user.telegramUsername) === username,
          )
        )
          throw Error("staff_exists");
        return [...current, candidate];
      },
    );
    target = candidate;
  }
  if (!target) {
    await telegramSend(token, id, "Сотрудник не найден.");
    return true;
  }
  try {
    const key = await issueStaffKey(actor, target.id, command === "disable");
    await telegramSend(
      token,
      id,
      command === "disable"
        ? `Доступ @${username} отключён.`
        : `Персональный ключ для @${username}:\n\n${key}\n\nПередайте его только этому сотруднику. Вход: ${SITE}/login\nПосле входа: своя карточка → «Подключить мой Telegram». Прежний ключ больше не действует.`,
    );
  } catch {
    await telegramSend(
      token,
      id,
      "Действие запрещено: нельзя отключить себя или управлять владельцем без роли владельца.",
    );
  }
  return true;
}
export async function handleCrmBotUpdate(
  update: any,
  token: string,
): Promise<boolean> {
  const callback = update?.callback_query;
  const message = callback?.message || update?.message;
  const from = callback?.from || message?.from;
  if (
    message?.chat?.type !== "private" ||
    !from?.id ||
    String(message.chat.id) !== String(from.id)
  )
    return false;
  const id = String(from.id);
  let text = String(update?.message?.text || "").trim();
  text = ({"📥 Заявки":"/inbox","👥 Команда":"/team","🌐 Открыть CRM":"/admin"} as Record<string,string>)[text] || text;
  const data = String(callback?.data || "");
  if (/^\/(?:start|menu|catalog|cars|site|request)(?:@avtocena_bot)?(?:\s|$)/i.test(text) || ["cust:new", "cust:confirm", "cust:my"].includes(data) || text === "/my" || text === "📝 Оставить заявку" || text === "📩 Мои обращения") {
    await sendCustomerWelcome(token, id);
    return true;
  }
  const actor = await botAdmin(id);
  if (/^\/start(?:@avtocena_bot)?(?:\s|$)/i.test(text) && !/^\/start\s+staff_/.test(text) || text === "/request" || text === "📝 Оставить заявку" || ["cust:new", "cust:confirm"].includes(data) || /https:\/\/avtocena\.com\/cars\/offer\//i.test(text)) {
    const offerId = text.match(/(?:chat_|offer_|cars\/offer\/)([A-Za-z0-9_-]{1,100})/)?.[1];
    await saveDialog(id, {});
    await telegramSend(token, id, "Обращения принимаем через форму на сайте. Укажите автомобиль и удобный контакт — менеджер свяжется с вами.", [[{text:"Оставить заявку на сайте",url:offerId ? `${SITE}/cars/offer/${encodeURIComponent(offerId)}` : `${SITE}/request`}]]);
    return true;
  }
  const rawDialog = await readDataJson<Dialog>(dialogPath(id), {});
  const dialog =
    rawDialog.updatedAt && Date.now() - rawDialog.updatedAt < 24 * 3600000
      ? rawDialog
      : {};
  const staffStart = text.match(/^\/start\s+staff_([A-Za-z0-9_-]{24,64})$/);
  if (staffStart) {
    await telegramSend(token, id, "Привязка Telegram больше не требуется. Войдите в CRM по логину и персональному ключу. Новые заявки поступают в закрытую группу команды.");
    return true;
  }
  if (
    data.startsWith("crm:") ||
    /^\/(admin|team|invite|key|disable|inbox)(?:\s|$)/.test(text)
  ) {
    if (!actor) {
      await telegramSend(
        token,
        id,
        "Заявки команды находятся в закрытой группе. Для работы в CRM войдите на сайт по логину и персональному ключу.",
      );
      return true;
    }
    if (await staffCommand(token, id, actor, text)) return true;
    if (data === "crm:team" || text === "/team") {
      await teamMenu(token, id);
      return true;
    }
    if (data.startsWith("crm:reply:")) {
      const leadId = data.slice(10);
      const lead = (
        await readChunkedDataJson<any>("leads/leads.json", [])
      ).find((lead) => lead.id === leadId && !lead.archivedAt);
      if (!lead?.telegramChatId) {
        await telegramSend(
          token,
          id,
          "Клиент ещё не подключил Telegram к этой заявке. Используйте указанный в CRM контакт.",
        );
        return true;
      }
      await saveDialog(id, { mode: "staffReply", leadId });
      await telegramSend(
        token,
        id,
        `Ответ клиенту: ${lead.name || lead.telegramDisplayName || "клиент"}\n${lead.car || ""}\n\nВведите текст ответа. Перед отправкой будет подтверждение. /cancel — отмена.`,
      );
      return true;
    }
    if (data === "crm:send") {
      if (
        dialog.mode !== "staffConfirm" ||
        !dialog.leadId ||
        !dialog.description
      ) {
        await telegramSend(
          token,
          id,
          "Нет подготовленного ответа. Выберите заявку заново.",
        );
        return true;
      }
      const lead = (
        await readChunkedDataJson<any>("leads/leads.json", [])
      ).find((lead) => lead.id === dialog.leadId && !lead.archivedAt);
      if (!lead?.telegramChatId) {
        await saveDialog(id, {});
        await telegramSend(
          token,
          id,
          "Заявка закрыта для ответа или Telegram клиента не подключён.",
        );
        return true;
      }
      await enqueueMessage({
        id: `reply_${dialog.requestId}`,
        chatId: String(lead.telegramChatId),
        text: `Менеджер АвтоЦены · ${actor.displayName}\n\n${dialog.description}`,
        leadId: lead.id,
        audience: "customer",
      });
      await appendChunkedDataJson("telegram/crm-messages.json", {
        id: `reply_${dialog.requestId}`,
        leadId: lead.id,
        direction: "out",
        text: dialog.description,
        createdAt: new Date().toISOString(),
        managerId: actor.id,
        managerName: actor.displayName,
      });
      await saveDialog(id, {});
      await telegramSend(
        token,
        id,
        "Ответ сохранён и поставлен на отправку клиенту.",
      );
      return true;
    }
    if (data.startsWith("crm:view:")) {
      const lead = (await readChunkedDataJson<any>("leads/leads.json", [])).find(row => row.id === data.slice(9) && !row.archivedAt);
      await telegramSend(token, id, lead ? `${leadNotice(lead)}\nСтатус: ${leadStatusLabel(lead.status)}` : "Заявка недоступна.", lead ? [
        [{ text: "Ответить клиенту", callback_data: `crm:reply:${lead.id}` }],
        [{ text: "Открыть CRM", url: `${SITE}/crm/leads?id=${encodeURIComponent(lead.id)}` }],
        [{ text: "К списку", callback_data: "crm:inbox" }],
      ] : adminKeyboard);
      return true;
    }
    if (data === "crm:inbox" || /^crm:inbox:\d+$/.test(data) || text === "/inbox") {
      const leads = (await readChunkedDataJson<any>("leads/leads.json", []))
        .filter((lead) => !lead.archivedAt)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const page = Math.min(Math.max(0, Number(data.split(":")[2]) || 0), Math.max(0, Math.ceil(leads.length / 8) - 1));
      await telegramSend(
        token,
        id,
        leads.length
          ? `Общая очередь: ${leads.length}. Страница ${page + 1}. Выберите заявку.`
          : "Активных заявок пока нет.",
        [...leads.slice(page * 8, page * 8 + 8).map((lead) => [
          {
            text: `${lead.name || "Клиент"} · ${lead.car || "Подбор"}`.slice(
              0,
              60,
            ),
            callback_data: `crm:view:${lead.id}`,
          },
        ]), ...(page > 0 ? [[{ text: "Назад", callback_data: `crm:inbox:${page - 1}` }]] : []),
        ...((page + 1) * 8 < leads.length ? [[{ text: "Далее", callback_data: `crm:inbox:${page + 1}` }]] : [])],
      );
      return true;
    }
    await adminMenu(token, id);
    return true;
  }
  if (text === "/cancel" || data === "cust:cancel") {
    await saveDialog(id, {});
    await telegramSend(
      token,
      id,
      "Действие отменено.",
      actor ? adminKeyboard : customerKeyboard,
    );
    return true;
  }
  if (actor && /^\/(start|menu)$/.test(text)) {
    await saveDialog(id, {});
    await adminMenu(token, id);
    return true;
  }
  if (dialog.mode === "staffReply" && text && !text.startsWith("/")) {
    if (!actor) {
      await saveDialog(id, {});
      await telegramSend(token, id, "Служебный доступ отключён.");
      return true;
    }
    await saveDialog(id, {
      ...dialog,
      mode: "staffConfirm",
      description: text.slice(0, 3000),
      requestId: String(update.update_id),
    });
    await telegramSend(
      token,
      id,
      `Отправить клиенту этот ответ?\n\n${text.slice(0, 3000)}`,
      [
        [{ text: "Отправить клиенту", callback_data: "crm:send" }],
        [{ text: "Отмена", callback_data: "cust:cancel" }],
      ],
    );
    return true;
  }
  if (text === "/my" || text === "📩 Мои обращения" || data === "cust:my") {
    const leads = await ownLeads(id);
    await telegramSend(
      token,
      id,
      leads.length
        ? "Ваши обращения — выберите, чтобы продолжить переписку."
        : "У вас пока нет обращений.",
      leads.length
        ? leads
            .slice(0, 10)
            .map((lead) => [
              {
                text: `${leadStatusLabel(lead.status)} · ${lead.car || "Подбор"}`.slice(
                  0,
                  60,
                ),
                callback_data: `cust:chat:${lead.id}`,
              },
            ])
        : customerKeyboard,
    );
    return true;
  }
  if (data.startsWith("cust:chat:")) {
    const lead = (await ownLeads(id)).find(
      (lead) => lead.id === data.slice(10),
    );
    if (!lead) {
      await telegramSend(token, id, "Обращение недоступно.");
      return true;
    }
    await saveDialog(id, { mode: "conversation", leadId: lead.id });
    await telegramSend(
      token,
      id,
      `${lead.car || "Подбор автомобиля"}\nСтатус: ${leadStatusLabel(lead.status)}\nНапишите сообщение менеджеру.`,
    );
    return true;
  }
  if (
    !text &&
    !callback &&
    (update.message?.photo ||
      update.message?.document ||
      update.message?.voice ||
      update.message?.video)
  ) {
    await telegramSend(
      token,
      id,
      "Пока передаю менеджеру текстовые сообщения. Напишите вопрос текстом; отправку файлов можно согласовать с менеджером.",
    );
    return true;
  }
  if (
    text &&
    !text.startsWith("/") &&
    !/^(🚗|🧮|📚|🔔|❤️|🛡|💳|🌐)/u.test(text)
  ) {
    if (actor) {
      await telegramSend(
        token,
        id,
        "Чтобы ответить клиенту, нажмите «Ответить клиенту» под его сообщением. /team — команда.",
        adminKeyboard,
      );
      return true;
    }
    const leads = await ownLeads(id);
    const lead =
      leads.find((lead) => lead.id === dialog.leadId) ||
      (leads.length === 1 ? leads[0] : null);
    if (!lead) {
      if (/^\d[\d\s,.]*$/.test(text)) return false;
      await telegramSend(
        token,
        id,
        "Выберите обращение в «Мои обращения» или создайте запрос менеджеру.",
        customerKeyboard,
      );
      return true;
    }
    const msgId = `customer_${update.update_id}`;
    await appendChunkedDataJson("telegram/crm-messages.json", {
      id: msgId,
      leadId: lead.id,
      direction: "in",
      text: text.slice(0, 3000),
      createdAt: new Date().toISOString(),
    });
    const users = await readDataJson<StaffUser[]>(
      "auth/users.json",
      getAuthUsers(),
    );
    for (const admin of users.filter(
      (user) =>
        user.status !== "disabled" &&
        ["owner", "admin"].includes(user.role) &&
        user.telegramId,
    ))
      await enqueueMessage({
        id: `${msgId}_${admin.id}`,
        chatId: String(admin.telegramId),
        leadId: lead.id,
        audience: "admin",
        text: `💬 Сообщение клиента · ${lead.name || "Клиент"}\n${lead.car || ""}\n\n${text.slice(0, 2800)}`,
        keyboard: [
          [{ text: "Ответить клиенту", callback_data: `crm:reply:${lead.id}` }],
          [
            {
              text: "Открыть заявку",
              url: `${SITE}/crm/leads?id=${encodeURIComponent(lead.id)}`,
            },
          ],
        ],
      });
    await telegramSend(token, id, "Сообщение сохранено для менеджера.");
    return true;
  }
  return false;
}
