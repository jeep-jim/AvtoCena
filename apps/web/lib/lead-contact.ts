/** The selected channel is authoritative, including messenger accounts found by phone. */
export function leadContact(lead: any) {
  const messenger = lead.contactPreference === "message" ? lead.messenger : !lead.contactPreference ? lead.messenger || (lead.telegram ? "telegram" : lead.max ? "max" : "") : "";
  const channel = messenger === "telegram" || messenger === "max" ? messenger : "call";
  const raw = String(channel === "telegram" ? lead.telegram || lead.phone || "" : channel === "max" ? lead.max || lead.phone || "" : lead.phone || "").trim();
  const byPhone = lead.messengerContactKind === "phone" || /^\+?[0-9][0-9 ()-]+$/.test(raw);
  const value = channel !== "call" && raw && !byPhone ? `@${raw.replace(/^@+/, "")}` : raw;
  const label = channel === "telegram" ? "Telegram" : channel === "max" ? "MAX" : "Телефон · звонок";
  const detail = channel !== "call" ? byPhone ? "телефон аккаунта" : "никнейм" : "";
  // MAX username links are not assumed to be valid: show/copy the submitted contact.
  const href = channel === "call" && /^\+?[0-9 ()-]+$/.test(raw) ? `tel:${raw.replace(/[^+0-9]/g, "")}`
    : channel === "telegram" && !byPhone && /^@?[a-zA-Z][a-zA-Z0-9_]{3,63}$/.test(raw) ? `https://t.me/${raw.replace(/^@+/, "")}` : "";
  return {channel, value, label, detail, href, text: `${label}${detail ? ` (${detail})` : ""}: ${value || "не указан"}`};
}
