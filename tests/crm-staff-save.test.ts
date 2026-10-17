import assert from "node:assert/strict";
import { test } from "node:test";
import { staffIdentityChanged, staffRedirect } from "../apps/web/lib/crm-staff-save";

test("staff save preserves identity across case and leading @", () => {
  assert.equal(staffIdentityChanged("@NStasS", "nstass"), false);
  assert.equal(staffIdentityChanged("NStasS", " @NSTASS "), false);
  assert.equal(staffIdentityChanged("NStasS", "different_user"), true);
});
test("303 after a POST stays on public origin even behind an internal host", () => {
  const internal = new URL("/crm/managers/user_admin?state=saved", "https://0.0.0.0:8080");
  const response = staffRedirect(internal.pathname + internal.search);
  assert.equal(response.status, 303);
  assert.equal(new URL(response.headers.get("location")!, "https://avtocena.com/api/crm/users").href,
    "https://avtocena.com/crm/managers/user_admin?state=saved");
  assert.throws(() => staffRedirect("//other.test"));
  assert.throws(() => staffRedirect("/\\other.test"));
});
