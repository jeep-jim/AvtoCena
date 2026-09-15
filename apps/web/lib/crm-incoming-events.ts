import {appendChunkedDataJson, readChunkedDataJson, readDataJson, updateChunkedDataJson} from "./data";

const QUEUE = "telegram/crm-incoming.json";
type Event = {id: string; updateId: number; update: any; receivedAt: string; done?: boolean};
export function isPrivateCrmEvent(update: any) {
  const message = update?.callback_query?.message || update?.message;
  const from = update?.callback_query?.from || update?.message?.from;
  return Number.isSafeInteger(update?.update_id) && update.update_id >= 0
    && message?.chat?.type === "private" && from?.id > 0
    && String(message.chat.id) === String(from.id);
}
export async function enqueueCrmEvent(update: any) {
  if (!isPrivateCrmEvent(update)) return "ignored";
  const receipt = await readDataJson<any>(`telegram/crm-updates/${update.update_id}.json`, {});
  if (receipt.done) return "done";
  await appendChunkedDataJson<Event>(QUEUE, {id: `update_${update.update_id}`, updateId: update.update_id,
    update, receivedAt: new Date().toISOString()});
  return "queued";
}
export async function pendingCrmEvents(offset: number) {
  const rows = await readChunkedDataJson<Event>(QUEUE, []);
  // Webhook deliveries may arrive out of order. Retire by receipt, not offset.
  for (const row of rows.filter(row => !row.done)) {
    const receipt = await readDataJson<any>(`telegram/crm-updates/${row.updateId}.json`, {});
    if (!receipt.done) continue;
    await updateChunkedDataJson<Event>(QUEUE, row.id, current => ({...current, done: true, update: null}));
    row.done = true;
  }
  return rows.filter(row => !row.done && row.update)
    .sort((a, b) => a.updateId - b.updateId).slice(0, 8).map(row => row.update);
}
