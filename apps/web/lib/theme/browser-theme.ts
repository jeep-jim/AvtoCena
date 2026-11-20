export type SiteTheme = "light" | "dark";
export type SiteThemePreference = SiteTheme | "system";
export type SiteThemeSnapshot = `${SiteThemePreference}:${SiteTheme}`;

export const siteThemeEvent = "avtocena:theme-changed";
export const siteThemeServerSnapshot: SiteThemeSnapshot = "system:dark";

declare global {
  interface Window {
    avtocenaBrowserTheme?: {
      snapshot(): SiteThemeSnapshot;
      set(preference: SiteThemePreference): void;
    };
  }
}

// Literal script executes in <head> before paint/hydration; source-text
// serialization of a transpiled function can capture unavailable helpers.
export const browserThemeBootstrap = `
(function () {
  if (window.avtocenaBrowserTheme) return;
  const key = "avtocena_theme";
  const root = document.documentElement;
  const light = window.matchMedia?.("(prefers-color-scheme: light)");
  function readPreference() {
    try {
      const saved = window.localStorage.getItem(key);
      if (saved === "light" || saved === "dark") return saved;
    } catch {}
    return "system";
  }
  let preference = readPreference();
  function effective() {
    return preference === "system" ? (light?.matches ? "light" : "dark") : preference;
  }
  const snapshot = () => {
    const applied = root.dataset.theme;
    const theme = applied === "dark" || applied === "light" ? applied : effective();
    return preference + ":" + theme;
  };
  let previous;
  function sync() {
    // The Telegram mini app manages its own separate setting and SDK.
    if (root.dataset.miniapp === "true") return;
    const theme = effective();
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    const current = snapshot();
    if (current === previous) return;
    previous = current;
    window.dispatchEvent(new CustomEvent("avtocena:theme-changed", { detail: { theme } }));
  }
  window.avtocenaBrowserTheme = {
    snapshot,
    set(value) {
      if (value !== "light" && value !== "dark" && value !== "system") return;
      preference = value;
      try {
        if (value === "system") window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
      } catch {}
      sync();
    },
  };
  if (typeof light?.addEventListener === "function") light.addEventListener("change", sync);
  else light?.addListener?.(sync);
  window.addEventListener("storage", (event) => {
    if (event.key !== key && event.key !== null) return;
    try {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
    } catch { return; }
    preference = readPreference();
    sync();
  });
  // A same-document route can leave mini mode without a new media event.
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["data-miniapp"] });
  sync();
})();
`;
