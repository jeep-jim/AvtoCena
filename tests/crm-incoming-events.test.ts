import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {enqueueCrmEvent, pendingCrmEvents, isPrivateCrmEvent} from "../apps/web/lib/crm-incoming-events";
import {enablePolling, pollBatch} from "../apps/web/lib/crm-polling";
import {resetJsonStorageForTests} from "../apps/web/lib/data";

const event = (id: number) => ({update_id: id, message: {chat: {id: 42, type: "private"}, from: {id: 42}, text: "/start"}});
test("incoming queue deduplicates, retains failed events, and does not drop late lower IDs", async () => {
  const cwd = process.cwd(), driver = process.env.JSON_STORAGE_DRIVER;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crm-events-"));
  fs.mkdirSync(path.join(tmp, "data")); process.chdir(tmp);
  process.env.JSON_STORAGE_DRIVER = "local"; resetJsonStorageForTests();
  try {
    await enablePolling();
    await enqueueCrmEvent(event(20)); await enqueueCrmEvent(event(20));
    assert.equal((await pendingCrmEvents(0)).length, 1);
    await assert.rejects(pollBatch(pendingCrmEvents, async () => {throw Error("temporary failure");}, false));
    assert.equal((await pendingCrmEvents(0)).length, 1);
    const handled: number[] = [];
    await pollBatch(pendingCrmEvents, async update => {handled.push(update.update_id);}, false);
    assert.equal((await pendingCrmEvents(0)).length, 0);
    await enqueueCrmEvent(event(19));
    await pollBatch(pendingCrmEvents, async update => {handled.push(update.update_id);}, false);
    assert.deepEqual(handled, [20, 19]);
    assert.equal(await enqueueCrmEvent(event(20)), "done");
    assert.equal(isPrivateCrmEvent({...event(30), message: {chat: {id: -42, type: "group"}, from: {id: 42}}}), false);
  } finally {
    process.chdir(cwd);
    if (driver === undefined) delete process.env.JSON_STORAGE_DRIVER; else process.env.JSON_STORAGE_DRIVER = driver;
    resetJsonStorageForTests(); fs.rmSync(tmp, {recursive: true, force: true});
  }
});
