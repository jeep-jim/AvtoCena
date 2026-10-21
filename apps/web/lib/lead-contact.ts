/** A single instruction for managers, without exposing form implementation fields. */
export function leadContactAction(lead: any) {
  const contact = leadContact(lead);
  const action = contact.channel === "call" ? "Позвонить" : `Написать в ${contact.label}`;
  return `${action}: ${contact.value || "контакт не указан"}${contact.detail ? ` (${contact.detail})` : ""}`;
}

/** The selected channel is authoritative, including messenger accounts found by phone. */
export function leadContact(lead: any) {
  const messenger = lead.contactPreference === "message" ? lead.messenger : !lead.contactPreference ? lead.messenger || (lead.telegram ? "telegram" : lead.max ? "max" : "") : "";
  const channel = messenger === "telegram" || messenger === "max" ? messenger : "call";
  const raw = String(channel === "telegram" ? lead.telegram || lead.phone || "" : channel === "max" ? lead.max || lead.phone || "" : lead.phone || "").trim();
  const byPhone = lead.messengerContactKind === "phone" || /^\+?[0-9][0-9 ()-]+$/.test(raw);
  const value = channel !== "call" && raw && !byPhone && !/^https:\/\//i.test(raw) ? `@${raw.replace(/^@+/, "")}` : raw;
  const label = channel === "telegram" ? "Telegram" : channel === "max" ? "MAX" : "Телефон · звонок";
  const detail = channel !== "call" ? byPhone ? "телефон аккаунта" : /^https:\/\//i.test(raw) ? "ссылка на профиль" : "никнейм" : "";
  // Telegram documents both username and international phone links.
  // https://core.telegram.org/api/links#phone-number-links
  const digits=raw.replace(/\D/g, "");
  const phone=/^[+0-9 ()-]+$/.test(raw)&&digits.length>=7&&digits.length<=15?digits.length===11&&digits.startsWith("8")?`7${digits.slice(1)}`:digits:"";
  let href=channel==="call"&&phone?`tel:+${phone}`
    :channel==="telegram"&&byPhone&&phone?`https://t.me/+${phone}`
    :channel==="telegram"&&!byPhone&&/^@?[a-zA-Z][a-zA-Z0-9_]{3,63}$/.test(raw)?`https://t.me/${raw.replace(/^@+/, "")}`:"";
  // Only use an actual MAX profile URL, never synthesize one from a phone/username.
  if(channel==="max")try{const url=new URL(raw);if(url.protocol==="https:"&&["max.ru","max.app"].includes(url.hostname)&&/^\/u\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)&&!url.username&&!url.password&&!url.port){href=url.href;}}catch{}
  return {channel, value, label, detail, href, text: `${label}${detail ? ` (${detail})` : ""}: ${value || "не указан"}`};
}
