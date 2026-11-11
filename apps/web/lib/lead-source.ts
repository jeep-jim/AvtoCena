/** Submission context only; never grants identity, permissions or consent. */
export function leadChannelLabel(lead: {submissionChannel?: string; source?: string}) {
  if (lead.submissionChannel === "telegram_miniapp") return "Telegram Mini App";
  if (lead.submissionChannel === "manual_crm" || lead.source === "manual_crm") return "Создана менеджером";
  if (lead.submissionChannel === "telegram_bot" || lead.source === "telegram_bot") return "Telegram-бот";
  return "Сайт";
}
