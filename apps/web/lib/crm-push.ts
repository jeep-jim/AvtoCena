import crypto from "node:crypto";
import webpush from "web-push";
import { readDataJson, mutateDataJson, readChunkedDataJson } from "./data";
import { canSeeLead, activeLead } from "./crm-visibility";
import { leadReadState } from "./crm-read-state";
import { validPushSubscription } from "./crm-push-policy";
import type { AuthUser } from "./auth";
const FILE = "auth/push-subscriptions.json";
const KEYS = "auth/push-vapid.json";
type Subscription = {id: string; userId: string; sessionVersion: number; subscription: webpush.PushSubscription; createdAt: number; updatedAt: number; deliveredAt: number; lease?: string; leaseUntil?: number};
export async function pushKeys() {
  const current = await readDataJson<{publicKey: string; privateKey: string} | null>(KEYS, null);
  if (current?.publicKey && current.privateKey) return current;
  return mutateDataJson(KEYS, current, value => value?.publicKey && value.privateKey ? value : webpush.generateVAPIDKeys());
}
export async function registerPush(user: AuthUser, subscription: webpush.PushSubscription) {
  if (!validPushSubscription(subscription)) throw Error("invalid_subscription");
  const id = crypto.createHash("sha256").update(subscription.endpoint).digest("hex");
  await mutateDataJson<Subscription[]>(FILE, [], rows => {
    const now = Date.now();
    const old = rows.find(row => row.id === id && row.userId === user.id && row.sessionVersion === (user.sessionVersion || 0));
    const valid = rows.filter(row => row.id !== id && row.updatedAt > now - 90 * 86400_000);
    if (valid.filter(row => row.userId === user.id).length >= 10 || valid.length >= 500) throw Error("device_limit");
    return [...valid, {id, userId: user.id, sessionVersion: user.sessionVersion || 0, subscription, createdAt: old?.createdAt || now, updatedAt: now, deliveredAt: old?.deliveredAt || now, lease: old?.lease, leaseUntil: old?.leaseUntil}];
  });
}
export async function removePush(userId: string, endpoint: string) {
  await mutateDataJson<Subscription[]>(FILE, [], rows => rows.filter(row => row.userId !== userId || row.subscription.endpoint !== endpoint));
}
export async function flushCrmPush(limit = 10) {
  const rows = await readDataJson<Subscription[]>(FILE, []);
  if (!rows.length) return {sent: 0};
  const users = await readDataJson<AuthUser[]>("auth/users.json", []);
  const leads = (await readChunkedDataJson<any>("leads/leads.json", [])).filter(activeLead);
  const keys = await pushKeys(); if (!keys) return {sent: 0};
  let sent = 0, attempted = 0;
  for (const row of rows) {
    if (attempted >= limit) break;
    const user = users.find(u => u.id === row.userId && u.status !== "disabled" && (u.sessionVersion || 0) === row.sessionVersion);
    if (!user || row.updatedAt < Date.now() - 90 * 86400_000 || !validPushSubscription(row.subscription)) { await removePush(row.userId, row.subscription.endpoint); continue; }
    const pending = leads.filter(lead => canSeeLead(user, lead)).map(lead => leadReadState(lead, user.id)).filter(state => state.unread);
    const newer = pending.filter(state => Math.max(Date.parse(state.incomingAt)||0, Date.parse(state.assignmentAt)||0) > row.deliveredAt);
    if (!newer.length) continue;
    const latest = Math.max(...newer.map(state => Math.max(Date.parse(state.incomingAt)||0, Date.parse(state.assignmentAt)||0)));
    const lease = crypto.randomUUID(); let acquired = false;
    await mutateDataJson<Subscription[]>(FILE, [], items => {
      acquired = false;
      return items.map(item => { if (item.id !== row.id || item.userId !== row.userId || item.deliveredAt >= latest || (item.leaseUntil || 0) > Date.now()) return item; acquired = true; return {...item, lease, leaseUntil: Date.now() + 60_000}; });
    });
    if (!acquired) continue;
    attempted++;
    let delivered = false, expired = false;
    try {
      // Recheck current account and current lead permissions just before sending.
      const currentSubscription = (await readDataJson<Subscription[]>(FILE, [])).find(item => item.id === row.id && item.userId === row.userId && item.lease === lease);
      if (!currentSubscription) continue;
      const freshUsers = await readDataJson<AuthUser[]>("auth/users.json", []);
      const freshUser = freshUsers.find(u => u.id === row.userId && u.status !== "disabled" && (u.sessionVersion || 0) === row.sessionVersion);
      const freshLeads = await readChunkedDataJson<any>("leads/leads.json", []);
      const unread = freshUser ? freshLeads.filter(l => activeLead(l) && canSeeLead(freshUser, l) && leadReadState(l, freshUser.id).unread) : [];
      const events = unread.map(l => leadReadState(l, row.userId)).filter(s => Math.max(Date.parse(s.incomingAt)||0, Date.parse(s.assignmentAt)||0) > row.deliveredAt);
      if (!events.length) { delivered = true; continue; }
      await webpush.sendNotification(row.subscription, JSON.stringify({title: "АвтоЦена · Новая заявка", body: events.some(e => e.assignmentUnread) ? "Вам назначена заявка. Откройте CRM." : `Непросмотренных заявок: ${unread.length}`, count: unread.length, url: "/crm/leads"}), {TTL: 3600, urgency: "high", timeout: 5000, vapidDetails: {subject: "https://avtocena.com", publicKey: keys.publicKey, privateKey: keys.privateKey}});
      delivered = true; sent++;
    } catch (error: any) { expired = [404, 410].includes(error?.statusCode); }
    finally {
      await mutateDataJson<Subscription[]>(FILE, [], items => items.flatMap(item => item.id !== row.id || item.lease !== lease ? [item] : expired ? [] : [{...item, deliveredAt: delivered ? latest : item.deliveredAt, lease: undefined, leaseUntil: delivered ? 0 : Date.now() + 60_000}]));
    }
  }
  return {sent};
}
