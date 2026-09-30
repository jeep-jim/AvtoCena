import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { defaultShowcase } from "../apps/web/lib/dealers/showcase-model";
const require = createRequire(import.meta.url);
test("dealer writes enforce current owner role and origin before accepting content", async () => {
  const cwd = process.cwd(),
    driver = process.env.JSON_STORAGE_DRIVER;
  const out = path.resolve("artifacts/dealer-api-tests");
  fs.mkdirSync(out, { recursive: true });
  const entries = {
    showcase: "apps/web/app/(crm)/api/crm/dealers/[id]/showcase/route.ts",
    media: "apps/web/app/(crm)/api/crm/dealers/[id]/media/route.ts",
    features: "apps/web/app/(crm)/api/crm/public-features/route.ts",
    geocode: "apps/web/app/(crm)/api/crm/dealers/[id]/geocode/route.ts",
  };
  const modules: any = {};
  for (const [name, entry] of Object.entries(entries)) {
    const file = path.join(out, `${name}.cjs`);
    await build({
      entryPoints: [entry],
      outfile: file,
      bundle: true,
      platform: "node",
      format: "cjs",
      packages: "external",
      plugins: [
        {
          name: "test-auth",
          setup(b) {
            b.onResolve({ filter: /^@\/lib\/auth$/ }, () => ({
              path: "auth",
              namespace: "test",
            }));
            b.onLoad({ filter: /.*/, namespace: "test" }, () => ({
              contents:
                "export async function getCurrentUser(){return globalThis.__dealerTestActor||null}",
            }));
          },
        },
      ],
    });
    modules[name] = require(file);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dealer-permissions-"));
  fs.mkdirSync(path.join(tmp, "data"));
  process.chdir(tmp);
  process.env.JSON_STORAGE_DRIVER = "local";
  const context = { params: Promise.resolve({ id: "dealer_topavto" }) };
  const request = (
    method = "PUT",
    origin = "https://avtocena.com",
    body: any = defaultShowcase("dealer_topavto"),
  ) =>
    new Request(
      "https://avtocena.com/api/crm/dealers/dealer_topavto/showcase",
      {
        method,
        headers: { origin, "content-type": "application/json" },
        ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
      },
    );
  try {
    for (const role of [null, "admin", "manager", "partner", "client"]) {
      (globalThis as any).__dealerTestActor = role
        ? { id: "actor", role }
        : null;
      assert.equal(
        (await modules.showcase.GET(request("GET"), context)).status,
        403,
      );
      assert.equal(
        (await modules.showcase.PUT(request(), context)).status,
        403,
      );
      assert.equal(
        (await modules.media.POST(request("POST"), context)).status,
        403,
      );
      assert.equal((await modules.features.PUT(request())).status, 403);
      assert.equal(
        (await modules.geocode.POST(request("POST"), context)).status,
        403,
      );
    }
    (globalThis as any).__dealerTestActor = { id: "owner", role: "owner" };
    assert.equal(
      (
        await modules.showcase.PUT(
          request("PUT", "https://attacker.example"),
          context,
        )
      ).status,
      403,
    );
    assert.equal(
      (await modules.showcase.GET(request("GET"), context)).status,
      200,
    );
    const r = await modules.showcase.PUT(request(), context);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).version, 1);
    assert.equal((await modules.showcase.PUT(request(), context)).status, 409);
    assert.equal(
      (
        await modules.features.PUT(
          request("PUT", "https://avtocena.com", {
            version: 0,
            affiliatesEnabled: false,
          }),
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await modules.geocode.POST(
          request("POST", "https://avtocena.com", {
            city: "Москва",
            address: "Тест",
          }),
          context,
        )
      ).status,
      400,
    );
  } finally {
    delete (globalThis as any).__dealerTestActor;
    process.chdir(cwd);
    if (driver === undefined) delete process.env.JSON_STORAGE_DRIVER;
    else process.env.JSON_STORAGE_DRIVER = driver;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
