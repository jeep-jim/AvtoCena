import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { browserThemeBootstrap } from "../apps/web/lib/theme/browser-theme";

function browser({ light = false, stored, blocked = false, legacy = false }: {light?: boolean; stored?: string; blocked?: boolean; legacy?: boolean} = {}) {
  const writes: [string, string?][] = [];
  const callbacks: Record<string, (event: any) => void> = {};
  const root = { dataset: {} as Record<string, string>, style: { colorScheme: "" } };
  const events: unknown[] = [];
  let onMedia = () => {};
  let onMini = () => {};
  const media = { matches: light } as {matches: boolean;addEventListener?: (event: string, fn: () => void) => void;addListener?: (fn: () => void) => void};
  if (legacy) media.addListener = (fn) => { onMedia = fn; };
  else media.addEventListener = (event, fn) => { assert.equal(event, "change"); onMedia = fn; };
  const storage = {
    getItem: () => { if (blocked) throw Error("denied"); return stored; },
    setItem: (key: string, value: string) => { writes.push([key, value]); if (blocked) throw Error("denied"); stored = value; },
    removeItem: (key: string) => { writes.push([key]); if (blocked) throw Error("denied"); stored = undefined; },
  };
  const window = {
    localStorage: storage,
    matchMedia: (query: string) => { assert.equal(query, "(prefers-color-scheme: light)"); return media; },
    addEventListener: (name: string, handler: (event: unknown) => void) => { callbacks[name] = handler; },
    dispatchEvent: (event: unknown) => { events.push(event); },
    avtocenaBrowserTheme: undefined as Window["avtocenaBrowserTheme"],
  };
  class Observer {
    constructor(callback: () => void) { onMini = callback; }
    observe(node: typeof root, options: MutationObserverInit) {
      assert.equal(node, root); assert.equal(options.attributeFilter?.[0], "data-miniapp");
    }
  }
  vm.runInNewContext(browserThemeBootstrap, {
    window, document: { documentElement: root }, MutationObserver: Observer,
    CustomEvent: class { constructor(public type: string, public value: unknown) {} },
  });
  return { ...window.avtocenaBrowserTheme!, root, writes, events,
    media(value: boolean) { media.matches = value; onMedia(); },
    fromTab(value?: string) { stored = value; callbacks.storage({ key: value ? "avtocena_theme" : null, storageArea: storage }); },
    mini(on: boolean) { if (on) root.dataset.miniapp = "true"; else delete root.dataset.miniapp; onMini(); },
  };
}

test("initial browser light/dark applies before hydration; changes are live and never persisted as an override", () => {
  for (const initial of [true, false]) {
    const page = browser({ light: initial });
    assert.equal(page.snapshot(), initial ? "system:light" : "system:dark");
    assert.equal(page.root.style.colorScheme, initial ? "light" : "dark");
    page.media(!initial);
    assert.equal(page.snapshot(), initial ? "system:dark" : "system:light");
    assert.equal(page.events.length, 2);
    assert.deepEqual(page.writes, []);
  }
});

test("keeps legacy explicit values, persists only explicit changes, and resumes system on reset", () => {
  const page = browser({ light: true, stored: "dark" });
  assert.equal(page.snapshot(), "dark:dark");
  page.media(false);
  page.media(true);
  assert.equal(page.events.length, 1);
  assert.deepEqual(page.writes, []);
  page.set("light");
  page.media(false);
  assert.equal(page.snapshot(), "light:light");
  page.set("system");
  assert.equal(page.snapshot(), "system:dark");
  page.media(true);
  assert.equal(page.snapshot(), "system:light");
  assert.deepEqual(page.writes, [["avtocena_theme", "light"], ["avtocena_theme"]]);
});

test("follows another tab's override and clear without echoing them into storage", () => {
  const page = browser({ light: false });
  page.fromTab("light");
  assert.equal(page.snapshot(), "light:light");
  page.fromTab();
  assert.equal(page.snapshot(), "system:dark");
  assert.deepEqual(page.writes, []);
});

test("storage denial and older browser listeners still work; Telegram keeps its own theme", () => {
  const page = browser({ light: true, blocked: true, legacy: true });
  assert.equal(page.snapshot(), "system:light");
  page.set("dark");
  assert.equal(page.snapshot(), "dark:dark");
  page.set("system");
  page.mini(true);
  page.root.dataset.theme = "dark";
  page.media(false);
  page.media(true);
  assert.equal(page.root.dataset.theme, "dark");
  page.mini(false);
  assert.equal(page.snapshot(), "system:light");
});
