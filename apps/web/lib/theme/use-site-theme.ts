"use client";

import { useSyncExternalStore } from "react";
import { siteThemeEvent, siteThemeServerSnapshot, type SiteThemePreference, type SiteTheme } from "./browser-theme";

const subscribe = (change: () => void) => {
  window.addEventListener(siteThemeEvent, change);
  return () => window.removeEventListener(siteThemeEvent, change);
};

export function useSiteTheme() {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => window.avtocenaBrowserTheme?.snapshot() ?? siteThemeServerSnapshot,
    () => siteThemeServerSnapshot,
  );
  const [preference, theme] = snapshot.split(":") as [SiteThemePreference, SiteTheme];
  return { preference, theme };
}

export function setSiteTheme(preference: SiteThemePreference) {
  window.avtocenaBrowserTheme?.set(preference);
}
