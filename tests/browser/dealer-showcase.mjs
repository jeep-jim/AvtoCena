import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const out = "artifacts/dealer-showcase";
fs.mkdirSync(out, { recursive: true });
await build({
  entryPoints: ["tests/browser/dealer-showcase-fixture.tsx"],
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  outdir: out,
  entryNames: "fixture",
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  plugins: [
    {
      name: "next",
      setup(b) {
        b.onResolve({ filter: /^next\/(link|navigation)$/ }, (args) => ({
          path: args.path,
          namespace: "mock",
        }));
        b.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
          contents:
            args.path === "next/link"
              ? `import React from 'react';export default function Link(props){return React.createElement('a',props)}`
              : `export const usePathname=()=>window.location.pathname;export const useSearchParams=()=>new URLSearchParams(window.location.search);export const useRouter=()=>({push:()=>{},replace:()=>{},prefetch:()=>{},back:()=>{}});`,
          loader: "jsx",
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
});
const publicCss =
  [
    "select-controls.css",
    "globals.css",
    "catalog-ui.css",
    "public-polish.css",
    "flat-ui.css",
    "public-regression-fixes.css",
  ]
    .map((f) => fs.readFileSync("apps/web/app/" + f, "utf8"))
    .join("\n") +
  "\n" +
  fs.readFileSync("apps/web/app/(crm)/crm-responsive.css", "utf8");
const css = await postcss([
  tailwindcss({
    content: [
      "tests/browser/dealer-showcase-fixture.tsx",
      "apps/web/components/{catalog,sharing,layout,home,autocalc,dealers}/**/*.tsx",
    ],
  }),
]).process(
  publicCss +
    "\n@tailwind base;@tailwind components;@tailwind utilities;html{--ac-surface:#161b25;--ac-surface-2:#242b38;--ac-text:#fff;--ac-muted:#acb5c4;--ac-border:#3f4856;background:#090d16;color:#fff}html[data-theme=dark]{--ac-surface:#1b222c;--ac-surface-2:#303b4c;--ac-text:#fff;--ac-muted:#b8c0cd;--ac-border:#465368}",
  { from: undefined },
);
fs.writeFileSync(`${out}/app.css`, css.css);
const html =
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (["/", "/autocalc"].includes(u.pathname)) {
    res.setHeader("Content-Type", "text/html");
    res.end(html);
    return;
  }
  const base = /^\/(buyers|pdf-flags|brands|avatars|logo)\//.test(u.pathname)
    ? path.resolve("apps/web/public")
    : path.resolve(out);
  const file = path.resolve(base, "." + u.pathname);
  if (
    !file.startsWith(base + path.sep) ||
    !fs.existsSync(file) ||
    !fs.statSync(file).isFile()
  ) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader(
    "Content-Type",
    /\.m?js$/.test(file)
      ? "text/javascript"
      : file.endsWith(".css")
        ? "text/css"
        : file.endsWith(".webp")
          ? "image/webp"
          : file.endsWith(".svg")
            ? "image/svg+xml"
            : "application/octet-stream",
  );
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_BIN,
  args: ["--no-sandbox"],
});
const results = [];
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({
        viewport: { width, height: 950 },
      }),
      page = await context.newPage();
    const errors = [],
      writes = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let accept = true;
    page.on("dialog", (d) => (accept ? d.accept() : d.dismiss()));
    await page.route("**/api/crm/**", async (route) => {
      const body = route.request().postDataJSON();
      writes.push({ url: route.request().url(), body });
      return route.fulfill({ json: { ...body, version: body.version + 1 } });
    });
    await page.goto(origin);
    await page
      .getByRole("button", { name: "Фото покупателей", exact: true })
      .click();
    const gallery = page.getByRole("switch", {
      name: "Показывать фотографии покупателей",
    });
    assert.equal(await gallery.isChecked(), true);
    await gallery.uncheck();
    accept = false;
    await page
      .getByRole("button", { name: "Сохранить настройки дилера" })
      .click();
    assert.equal(writes.length, 0);
    accept = true;
    await page
      .getByRole("button", { name: "Сохранить настройки дилера" })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Настройки сохранены" })
      .waitFor();
    assert.equal(writes[0].body.buyersEnabled, false);
    assert.equal(writes[0].body.buyerPhotos.length, 24);
    assert.equal(writes[0].body.specialsEnabled, false);
    await page
      .getByRole("button", { name: "Спецпредложения", exact: true })
      .click();
    await page.getByRole("button", { name: "+ Добавить автомобиль" }).click();
    await page
      .locator("summary")
      .filter({ hasText: "Новый автомобиль" })
      .click();
    await page.getByLabel("Марка", { exact: true }).fill("Toyota");
    await page.getByLabel("Модель", { exact: true }).fill("RAV4");
    await page
      .getByRole("button", { name: "Сохранить настройки дилера" })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector("[role=status]")?.textContent ===
        "Настройки сохранены",
    );
    assert.equal(writes[1].body.offers[0].status, "draft");
    assert.equal(writes[1].body.offers[0].make, "Toyota");
    await page.screenshot({
      path: `${out}/editor-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "ОСАГО и кредит", exact: true })
      .click();
    await page
      .getByRole("switch", { name: "Показывать ОСАГО и кредит" })
      .uncheck();
    await page
      .getByRole("button", { name: "Сохранить видимость сервисов" })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector("[role=status]")?.textContent ===
        "Настройки сохранены",
    );
    assert.equal(writes[2].body.affiliatesEnabled, false);
    const rail = page.getByRole("heading", { name: /СПЕЦ ПРЕДЛОЖЕНИЕ/ });
    await rail.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/rail-${width}.png` });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    assert.deepEqual(errors, []);
    results.push({
      width,
      saveConfirmation: true,
      galleryPreserved: 24,
      draft: true,
      servicesOff: true,
    });
    await context.close();
  }
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  server.close();
}
