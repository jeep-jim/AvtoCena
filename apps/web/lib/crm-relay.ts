import crypto from "node:crypto";
import { readChunkedDataJson, updateChunkedDataJson } from "./data";
import { digest, keyMatches } from "./crm-access";
import groupTarget from "./crm-group-target.json";
import { leadNotice, queueCrmAdminNotifications } from "./crm-notifications";

const QUEUE = "telegram/crm-outbox.json";
const LEASE_MS = 5 * 60_000;
export function crmRelayKey(secret: string) {
  return secret ? crypto.createHmac("sha256", secret).update("avtocena:crm-notification-relay:v1").digest("hex") : "";
}
export function crmRelayAuthorized(supplied: string, secret: string) {
  const expected = crmRelayKey(secret);
  return Boolean(expected && /^[a-f0-9]{64}$/.test(supplied) && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied)));
}
async function allowed(item: any) {
  if (item.audience !== "group" || String(item.chatId) !== groupTarget.chatId) return false;
  const lead = (await readChunkedDataJson<any>("leads/leads.json", [])).find(l => l.id === item.leadId);
  return Boolean(lead && !lead.archivedAt);
}
export async function claimCrmNotices() {
  await queueCrmAdminNotifications();
  const candidates = (await readChunkedDataJson<any>(QUEUE, []))
    .filter(item => ["group", "admin"].includes(item.audience) && !["sent", "cancelled"].includes(item.status)
      && Number(item.nextAttemptAt || 0) <= Date.now() && Number(item.relayUntil || 0) <= Date.now())
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 3);
  const notices = [];
  for (const candidate of candidates) {
    const token = crypto.randomBytes(32).toString("base64url");
    const permitted = await allowed(candidate);
    const row = await updateChunkedDataJson<any>(QUEUE, candidate.id, current => {
      if (["sent", "cancelled"].includes(current.status) || Number(current.relayUntil || 0) > Date.now()
        || Number(current.nextAttemptAt || 0) > Date.now()) return current;
      if (!permitted) return {...current, status: "cancelled"};
      return {...current, relayHash: digest(token), lastAckHash: "", relayUntil: Date.now() + LEASE_MS};
    });
    if (!row || !keyMatches(token, row.relayHash)) continue;
    // Only the explicitly approved group receives the public submission fields.
    // Internal notes and conversation history are never included.
    const lead = (await readChunkedDataJson<any>("leads/leads.json", [])).find(l => l.id === row.leadId);
    notices.push({id: row.id, token, chatId: String(row.chatId),
      audience: "group", text: leadNotice(lead).slice(0, 4000),
      url: `https://avtocena.com/crm/leads?id=${encodeURIComponent(row.leadId)}`});
  }
  return notices;
}
export async function authorizeCrmNotice(id: string, token: string) {
  const item = (await readChunkedDataJson<any>(QUEUE, [])).find(row => row.id === id);
  if (!item || ["sent", "cancelled"].includes(item.status) || !keyMatches(token, item.relayHash)
    || !(item.relayUntil > Date.now())) return false;
  if (await allowed(item)) return true;
  await updateChunkedDataJson<any>(QUEUE, id, row => keyMatches(token, row.relayHash) ? {...row, status: "cancelled", relayHash: "", relayUntil: 0} : row);
  return false;
}
export async function completeCrmNotice(id: string, token: string, messageId?: number) {
  const result = await updateChunkedDataJson<any>(QUEUE, id, row => {
    if (!keyMatches(token, row.relayHash)) return row;
    // Repeat acknowledgements are safe; retain the hash until the next claim.
    if (row.status === "sent") return row;
    if (row.status === "cancelled") return row;
    if (messageId) return {...row, status: "sent", sentAt: new Date().toISOString(), messageId,
      relayUntil: 0, lastError: ""};
    return {...row, status: "pending", relayUntil: 0, relayHash: "", lastAckHash: digest(token), attempts: Number(row.attempts || 0) + 1,
      nextAttemptAt: Date.now() + Math.min(3600_000, 30_000 * 2 ** Math.min(7, Number(row.attempts || 0))),
      lastError: "Не доставлено внешним отправителем, повтор запланирован"};
  });
  return Boolean(result && (messageId ? result.status === "sent" && result.messageId === messageId && keyMatches(token, result.relayHash) : result.lastAckHash === digest(token)));
}
