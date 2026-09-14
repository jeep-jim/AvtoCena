import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createSessionCookie,
  verifySessionCookie,
  resolveSessionUser,
  type AuthUser,
} from "../apps/web/lib/auth";
import {
  canManageStaff,
  digest,
  keyMatches,
  issueStaffKey,
  bindLink,
  bindStaff,
  botAdmin,
} from "../apps/web/lib/crm-access";
import { filterLeads } from "../apps/web/lib/crm-visibility";
import {
  readDataJson,
  writeDataJson,
  resetJsonStorageForTests,
} from "../apps/web/lib/data";
const owner: AuthUser = {
  id: "owner",
  telegramUsername: "owner_test",
  displayName: "Owner",
  role: "owner",
  status: "active",
  sessionVersion: 0,
};
const admin: AuthUser = {
  id: "admin",
  telegramUsername: "admin_test",
  displayName: "Admin",
  role: "admin",
  status: "active",
  sessionVersion: 0,
};
const manager: AuthUser = {
  id: "manager",
  telegramUsername: "manager_test",
  displayName: "Manager",
  role: "manager",
  status: "active",
  sessionVersion: 0,
};
test("personal key cannot authenticate as a different credential", () => {
  assert.equal(keyMatches("one", digest("two")), false);
  assert.equal(keyMatches("one", digest("one")), true);
  assert.equal(keyMatches("one", ""), false);
});
test("revocation and current role override the signed session", () => {
  const signed = verifySessionCookie(createSessionCookie(admin))!;
  assert.ok(signed);
  assert.equal(
    resolveSessionUser(signed, [{ ...admin, status: "disabled" }]),
    null,
  );
  assert.equal(
    resolveSessionUser(signed, [{ ...admin, sessionVersion: 1 }]),
    null,
  );
  assert.equal(resolveSessionUser(signed, []), null);
  assert.equal(
    resolveSessionUser(signed, [{ ...admin, role: "manager" }])?.role,
    "manager",
  );
});
test("manager cannot see others; archive stays outside active and new views", () => {
  const leads = [
    { id: "a", assignedManagerId: "manager", name: "Иван", status: "new" },
    { id: "b", assignedManagerId: "other", status: "new" },
    {
      id: "c",
      assignedManagerId: "manager",
      archivedAt: "2026-09-14",
      status: "new",
    },
  ];
  assert.deepEqual(
    filterLeads(leads, manager).map((lead) => lead.id),
    ["a"],
  );
  assert.deepEqual(
    filterLeads(leads, owner, { view: "archive" }).map((lead) => lead.id),
    ["c"],
  );
  assert.deepEqual(
    filterLeads(leads, admin, { q: "иван", status: "new" }).map(
      (lead) => lead.id,
    ),
    ["a"],
  );
  assert.equal(filterLeads(leads, null).length, 0);
});
test("numeric Telegram identity is bound by a one-time authenticated link; keys rotate and revoke", async () => {
  const cwd = process.cwd();
  const env = process.env.JSON_STORAGE_DRIVER;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "avtocena-crm-"));
  fs.mkdirSync(path.join(tmp, "data"));
  process.chdir(tmp);
  process.env.JSON_STORAGE_DRIVER = "local";
  resetJsonStorageForTests();
  try {
    await writeDataJson("auth/users.json", [owner, admin, manager]);
    assert.equal(canManageStaff(admin, owner), false);
    await assert.rejects(issueStaffKey(manager, "admin"));
    const key = await issueStaffKey(owner, "admin");
    const users = await readDataJson<any[]>("auth/users.json", []);
    assert.equal(
      keyMatches(key, users.find((user) => user.id === "admin").accessKeyHash),
      true,
    );
    assert.equal(users.find((user) => user.id === "admin").sessionVersion, 1);
    assert.equal(await botAdmin("12345"), null);
    const url = await bindLink(admin, "avtocena_bot");
    const token = new URL(url).searchParams.get("start")!.slice(6);
    assert.equal(await bindStaff(token, "12345", "another_user"), null);
    assert.ok(await bindStaff(token, "12345", "admin_test"));
    assert.equal(await bindStaff(token, "12345", "admin_test"), null);
    assert.equal((await botAdmin("12345"))?.id, "admin");
    await issueStaffKey(owner, "admin", true);
    assert.equal(await botAdmin("12345"), null);
    await assert.rejects(issueStaffKey(owner, "owner", true));
  } finally {
    process.chdir(cwd);
    if (env === undefined) delete process.env.JSON_STORAGE_DRIVER;
    else process.env.JSON_STORAGE_DRIVER = env;
    resetJsonStorageForTests();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
