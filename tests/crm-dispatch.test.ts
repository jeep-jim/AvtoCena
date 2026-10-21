import test from "node:test";
import assert from "node:assert/strict";
import {requestCrmDelivery} from "../apps/web/lib/crm-dispatch";

test("missing credentials do not call GitHub", async () => {
  assert.equal(await requestCrmDelivery("", (() => {throw Error("unexpected");}) as typeof fetch), "not_configured");
});
test("wake-up pins repository, workflow and branch and carries no lead data", async () => {
  assert.equal(await requestCrmDelivery("test-only", (async (url, init) => {
    assert.equal(String(url), "https://api.github.com/repos/jeep-jim/AvtoCena/actions/workflows/crm-telegram-delivery.yml/dispatches");
    assert.deepEqual(JSON.parse(String(init?.body)), {ref: "main", inputs: {operation: "notify"}});
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    return new Response(null, {status: 204});
  }) as typeof fetch), "accepted");
});
test("GitHub failures keep delivery pending without rejecting saved intake", async () => {
  for (const status of [401, 403, 429, 500]) {
    assert.equal(await requestCrmDelivery("test-only", (async () => new Response(null, {status})) as typeof fetch), "pending");
  }
  assert.equal(await requestCrmDelivery("test-only", (async () => {throw Error("network");}) as typeof fetch), "pending");
});
