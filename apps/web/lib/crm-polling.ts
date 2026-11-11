import crypto from "node:crypto";
import { mutateDataJson, readDataJson } from "./data";

export const POLL_STATE = "telegram/crm-polling.json";
type State = { enabled: boolean; offset: number; lease: string; until: number; eventDriven?: boolean };
const initial: State = { enabled: false, offset: 0, lease: "", until: 0 };
export async function pollingEnabled() {
  return (await readDataJson<State>(POLL_STATE, initial)).enabled;
}
export async function enablePolling() {
  await mutateDataJson<State>(POLL_STATE, initial, state => ({ ...state, enabled: true, eventDriven: false }));
}
export async function eventDrivenEnabled() {
  return Boolean((await readDataJson<State>(POLL_STATE, initial)).eventDriven);
}
export async function setEventDrivenMode(enabled: boolean) {
  await mutateDataJson<State>(POLL_STATE, initial, state => {
    if (state.until > Date.now()) throw Error("poller_busy");
    return {...state, enabled: true, eventDriven: enabled};
  });
}

// One bounded batch. Offset advances only after the existing handler succeeds.
// A failed request leaves the update available for the next run.
export async function pollBatch(
  getUpdates: (offset: number) => Promise<any[]>,
  handle: (update: any) => Promise<void>,
  advanceOffset = true,
) {
  const lease = crypto.randomUUID();
  let acquired = false;
  let offset = 0;
  await mutateDataJson<State>(POLL_STATE, initial, state => {
    acquired = false;
    if (!state.enabled || state.until > Date.now()) return state;
    acquired = true; offset = advanceOffset ? state.offset : 0;
    return { ...state, lease, until: Date.now() + 180_000 };
  });
  if (!acquired) return { processed: 0, inactiveOrBusy: true };
  let processed = 0;
  const started = Date.now();
  try {
    const updates = await getUpdates(offset);
    for (const update of updates.slice(0, 8)) {
      if (Date.now() - started > 90_000) break;
      if (!Number.isSafeInteger(update?.update_id) || update.update_id < offset) throw Error("invalid_update");
      await mutateDataJson<State>(POLL_STATE, initial, state => {
        if (state.lease !== lease || state.until <= Date.now()) throw Error("poll_lease_lost");
        return { ...state, until: Date.now() + 180_000 };
      });
      // Same receipt namespace as webhook: don't replay already handled updates.
      const path = `telegram/crm-updates/${update.update_id}.json`;
      let done = false;
      await mutateDataJson(path, { lease: "", until: 0, done: false }, receipt => {
        done = receipt.done;
        if (done) return receipt;
        if (receipt.until > Date.now()) throw Error("update_busy");
        return { ...receipt, lease, until: Date.now() + 180_000 };
      });
      if (!done) {
        try {
          await handle(update);
          await mutateDataJson(path, { lease: "", until: 0, done: false }, receipt => {
            if (receipt.lease !== lease) throw Error("update_lease_lost");
            return { ...receipt, done: true, until: 0 };
          });
        } finally {
          await mutateDataJson(path, { lease: "", until: 0, done: false }, receipt =>
            receipt.lease === lease ? { ...receipt, until: 0 } : receipt);
        }
      }
      offset = advanceOffset ? update.update_id + 1 : 0;
      await mutateDataJson<State>(POLL_STATE, initial, state => {
        if (state.lease !== lease) throw Error("poll_lease_lost");
        return { ...state, offset: advanceOffset ? offset : state.offset, until: Date.now() + 180_000 };
      });
      processed++;
    }
    return { processed, inactiveOrBusy: false };
  } finally {
    await mutateDataJson<State>(POLL_STATE, initial, state =>
      state.lease === lease ? { ...state, lease: "", until: 0 } : state);
  }
}
